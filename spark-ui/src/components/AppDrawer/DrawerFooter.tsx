import Button from "@mui/material/Button";
import * as React from "react";
import {
  BASE_CURRENT_PAGE,
  BASE_PATH,
  IS_HISTORY_SERVER_MODE,
} from "../../utils/UrlConsts";
import { getBaseAppUrl, isDataFlintSaaSUI, getProxyBasePath } from "../../utils/UrlUtils";

export default function DrawerFooter({ version }: { version?: string }) {
  const onSparkUiClick = (): void => {
    window.location.href = `${getBaseAppUrl(BASE_CURRENT_PAGE)}/jobs/`;
  };

  const onHistoryServerClick = (): void => {
    const basePath = getProxyBasePath();
    window.location.href = basePath;
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        margin: "5px",
        alignItems: "center",
        fontSize: "12px",
      }}
    >
      <Button onClick={onSparkUiClick} color="inherit">
        To Spark UI
      </Button>
      {IS_HISTORY_SERVER_MODE && !isDataFlintSaaSUI() ? (
        <Button onClick={onHistoryServerClick} color="inherit">
          To History Server
        </Button>
      ) : null}
      {`Version ${version}`}
    </div>
  );
}
