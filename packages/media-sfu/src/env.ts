export interface SfuEnv {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  announcedIp: string;
}

export function loadSfuEnv(): SfuEnv {
  const nodeEnv = process.env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const announcedIp = process.env.ANNOUNCED_IP || "127.0.0.1";

  if (isProduction && announcedIp === "127.0.0.1") {
    throw new Error("ANNOUNCED_IP must be set to the server's public IP in production");
  }

  return {
    nodeEnv,
    isProduction,
    port: Number(process.env.PORT || 4100),
    announcedIp,
  };
}
