import { ApiAction } from "../interfaces/APIAction";
import { AppStore, RunMetadataStore, SparkExecutorsStatus, StagesSummeryStore, StatusStore } from '../interfaces/AppStore';
import { SparkConfiguration } from "../interfaces/SparkConfiguration";
import { SparkStages } from "../interfaces/SparkStages";
import { humanFileSize } from "../utils/FormatUtils";
import isEqual from 'lodash/isEqual';
import { calculateSqlStore, updateSqlMetrics } from "./SqlReducer";
import { SparkExecutor, SparkExecutors } from "../interfaces/SparkExecutors";
import { Attempt } from '../interfaces/SparkApplications';
import moment from 'moment'

function extractRunMetadata(name: string, appId: string, attempt: Attempt): RunMetadataStore {
    const endTime = attempt.endTimeEpoch === -1 ? undefined : attempt.endTimeEpoch;

    return {
        appId: appId,
        sparkVersion: attempt.appSparkVersion,
        appName: name,
        startTime: attempt.startTimeEpoch,
        endTime: endTime
    }
}

function extractConfig(sparkConfiguration: SparkConfiguration): [string, Record<string, string>] {
    const sparkPropertiesObj = Object.fromEntries(sparkConfiguration.sparkProperties);
    const systemPropertiesObj = Object.fromEntries(sparkConfiguration.systemProperties);
    const runtimeObj = sparkConfiguration.runtime;

    const appName = sparkPropertiesObj["spark.app.name"];
    const config = {
        "spark.app.name": sparkPropertiesObj["spark.app.name"],
        "spark.app.id": sparkPropertiesObj["spark.app.id"],
        "sun.java.command": systemPropertiesObj["sun.java.command"],
        "spark.master": sparkPropertiesObj["spark.master"],
        "javaVersion": runtimeObj["javaVersion"],
        "scalaVersion": runtimeObj["scalaVersion"]
    };
    return [appName, config]
}

function calculateStageStatus(existingStore: StagesSummeryStore | undefined, stages: SparkStages): StagesSummeryStore {
    const stagesDataClean = stages.filter((stage) => stage.status != "SKIPPED")
    const totalActiveTasks = stagesDataClean.map((stage) => stage.numActiveTasks).reduce((a, b) => a + b, 0);
    const totalPendingTasks = stagesDataClean.map((stage) => stage.numTasks - stage.numActiveTasks - stage.numFailedTasks - stage.numCompleteTasks).reduce((a, b) => a + b, 0);
    const totalInput = stagesDataClean.map((stage) => stage.inputBytes).reduce((a, b) => a + b, 0);
    const totalOutput = stagesDataClean.map((stage) => stage.outputBytes).reduce((a, b) => a + b, 0);
    const totalDiskSpill = stagesDataClean.map((stage) => stage.diskBytesSpilled).reduce((a, b) => a + b, 0);
    const totalTaskTimeMs = stagesDataClean.map((stage) => stage.executorRunTime).reduce((a, b) => a + b, 0);

    const status = totalActiveTasks == 0 ? "idle" : "working";

    const state: StagesSummeryStore = {
        totalActiveTasks: totalActiveTasks,
        totalPendingTasks: totalPendingTasks,
        totalInput: humanFileSize(totalInput),
        totalOutput: humanFileSize(totalOutput),
        totalDiskSpill: humanFileSize(totalDiskSpill),
        totalTaskTimeMs: totalTaskTimeMs,
        status: status
    }

    if(existingStore === undefined) {
        return state;
    } else if(isEqual(state, existingStore)) {
        return existingStore;
    } else {
        return state;
    }
}

function calculateSparkExecutorsStatus(existingStore: SparkExecutorsStatus | undefined, totalTaskTimeMs: number | undefined, sparkExecutors: SparkExecutors): SparkExecutorsStatus {
    function msToHours(ms: number): number {
        return ms / 1000 / 60 / 60;
    }


    const driver = sparkExecutors.filter(executor => executor.id === "driver")[0];
    const executors = sparkExecutors.filter(executor => executor.id !== "driver");
    const activeExecutors = executors.filter(executor => executor.isActive);
    const numOfExecutors = activeExecutors.length;

    // if we are in local mode we should only count the driver, if we have executors we should only count the executors
    // because in local mode the driver does the tasks but in cluster mode the executors do the tasks
    const totalPotentialTaskTimeMs = numOfExecutors === 0 ? driver.totalDuration * driver.maxTasks : executors.map(executor => executor.totalDuration * executor.maxTasks).reduce((a, b) => a + b, 0);
    const totalCoreHour = sparkExecutors.map(executor => executor.totalCores * msToHours(executor.totalDuration)).reduce((a, b) => a + b, 0);
    const activityRate = totalPotentialTaskTimeMs !== 0 && totalTaskTimeMs !== undefined ? Math.min(100, (totalTaskTimeMs / totalPotentialTaskTimeMs * 100)) : 0;

    const state = {
        numOfExecutors,
        totalCoreHour,
        activityRate
    }

    if(existingStore === undefined) {
        return state;
    } else if(isEqual(state, existingStore)) {
        return existingStore;
    } else {
        return state;
    }

}

function calculateDuration(runMetadata: RunMetadataStore, currentEpocTime: number): number {
    return runMetadata.endTime === undefined ? currentEpocTime - runMetadata.startTime : runMetadata.endTime - runMetadata.startTime;
}


export function sparkApiReducer(store: AppStore, action: ApiAction): AppStore {
    switch (action.type) {
        case 'setInitial':
            const [appName, config] = extractConfig(action.config)
            const runMetadata = extractRunMetadata(appName, action.appId, action.attempt);
            const duration = calculateDuration(runMetadata, action.epocCurrentTime);
            const newStatus: StatusStore = { duration, stages: undefined, executors: undefined };
            const newStore: AppStore = { isInitialized: true, runMetadata: runMetadata, config: config, status: newStatus, sql: undefined };
            return newStore
        case 'setSQL':
            const sqlStore = calculateSqlStore(store.sql, action.value);
            if(sqlStore === store.sql) {
                return store;
            } else {
                return { ...store, sql: sqlStore };
            }
        case 'setStages':
            if(!store.isInitialized) {
                // Shouldn't happen as store should be initialized when we get updated metrics
                return store;
            }
            const stageStatus = calculateStageStatus(store.status.stages, action.value);
            if(stageStatus === store.status?.stages) {
                return store;
            } else {
                return { ...store, status: { ...store.status, stages: stageStatus } };
            }
            case 'setSparkExecutors':
                if(!store.isInitialized) {
                    // Shouldn't happen as store should be initialized when we get updated metrics
                    return store;
                }
                const executorsStatus = calculateSparkExecutorsStatus(store.status.executors, store.status.stages?.totalTaskTimeMs, action.value);
                if(executorsStatus === store.status.executors) {
                    return store;
                } else {
                    return { ...store, status: {...store.status, executors: executorsStatus }};
                }
        case 'setSQMetrics':
            if(store.sql === undefined) {
                // Shouldn't happen as store should be initialized when we get updated metrics
                return store;
            } else {
                return {...store, sql: updateSqlMetrics(store.sql, action.sqlId, action.value) };
            }
        case 'updateDuration':
            if(!store.isInitialized) {
                // Shouldn't happen as updateDuration should be sent after initialization
                return store;
            } else {
                return {...store, status: {...store.status, duration: calculateDuration(store.runMetadata, action.epocCurrentTime)} };
            }
        default:
            return store;
    }
}
