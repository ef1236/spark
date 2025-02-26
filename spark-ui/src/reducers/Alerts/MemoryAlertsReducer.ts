import { Alerts, ConfigStore, StatusStore, SparkExecutorStore } from "../../interfaces/AppStore";
import { humanFileSizeSparkConfigFormat, humanFileSize, calculatePercentage } from "../../utils/FormatUtils";
import { EnvironmentInfo } from "../../interfaces/ApplicationInfo";

const MAX_MEMORY_PERCENTAGE_TOO_HIGH_THRESHOLD = 95;
const MAX_MEMORY_PERCENTAGE_TOO_LOW_THRESHOLD = 70;
const MEMORY_INCREASE_RATIO = 0.2;
const MEMORY_DECREASE_SAFETY_BUFFER = 0.2;

export function reduceMemoryAlerts(
  { executors: statusExecutors }: StatusStore,
  { executorMemoryBytes, executorMemoryBytesSparkFormatString }: ConfigStore,
  environmentInfo: EnvironmentInfo | undefined, 
  executors: SparkExecutorStore[],
  alerts: Alerts
) {
  if (statusExecutors?.maxExecutorMemoryBytes) {
    checkMemoryUsage(
      statusExecutors.maxExecutorMemoryPercentage,
      executorMemoryBytes,
      executorMemoryBytesSparkFormatString,
      "executor",
      alerts
    );
  }

  if (environmentInfo?.driverXmxBytes) {
    const driverExecutor = executors?.find((exec) => exec.id === "driver");
    const driverMaxMemory = environmentInfo?.driverXmxBytes ?? 1;
    const driverMemoryUsage = driverExecutor?.HeapMemoryUsageBytes ?? 0;
    const driverMemoryUsagePercentage = calculatePercentage(driverMemoryUsage, driverMaxMemory);
  
    if (driverMemoryUsage) {
      checkMemoryUsage(
        driverMemoryUsagePercentage,
        driverMaxMemory,
        humanFileSizeSparkConfigFormat(driverMaxMemory),
        "driver",
        alerts
      );
    }
  }
}

function checkMemoryUsage(
  memoryPercentage: number,
  maxMemoryBytes: number,
  maxMemoryBytesString: string,
  type: "executor" | "driver",
  alerts: Alerts
) {
  const sourceMetric = type === "driver" ? "driverMemory" : "memory";
  const createAlert = (alertType: "High" | "Low", alertLevel: "error" | "warning") => {
    const suggestedMemory = humanFileSizeSparkConfigFormat(
      maxMemoryBytes * (1 + (alertType === "High" ? MEMORY_INCREASE_RATIO : MEMORY_DECREASE_SAFETY_BUFFER))
    );
    alerts.push({
      id: `${type}MemoryToo${alertType}_${memoryPercentage.toFixed(2)}`,
      name: `${type}MemoryToo${alertType}`,
      title: `${type.charAt(0).toUpperCase() + type.slice(1)} Memory ${alertType === "High" ? "Under" : "Over"}-Provisioned`,
      location: `In: Summary Page -> Memory Usage`,
      message: `Max ${type} Memory usage is ${memoryPercentage.toFixed(2)}% which is ${alertType === "High" ? "too high, and can cause spills and OOMs" : "too low, which means you can provision less memory and save $$$"}`,
      suggestion: `
        1. ${alertType === "High" ? "Increase" : "Decrease"} ${type} memory provisioning by changing "spark.${type}.memory" to ${suggestedMemory} 
           (the current usage is ${memoryPercentage.toFixed(2)}% but set to ${alertType === "High" ? "higher" : "lower"} as it needs some buffer) 
           from current value "${maxMemoryBytesString}"`,
      type: alertLevel,
      source: { type: "status", metric: sourceMetric },
    });
  };

  if (memoryPercentage > MAX_MEMORY_PERCENTAGE_TOO_HIGH_THRESHOLD) {
    createAlert("High", "error");
  } else if (type === "executor" && memoryPercentage < MAX_MEMORY_PERCENTAGE_TOO_LOW_THRESHOLD) {
    createAlert("Low", "warning");
  }
}