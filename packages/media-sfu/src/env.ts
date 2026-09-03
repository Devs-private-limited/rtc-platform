export interface SfuEnv {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  announcedIp: string;
  jwtSecret: string;
}

const DEV_JWT_SECRET = "dev-secret-change-in-production";

export function loadSfuEnv(): SfuEnv {
  const nodeEnv = process.env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const announcedIp = process.env.ANNOUNCED_IP || "127.0.0.1";
  const jwtSecret = process.env.JWT_SECRET || DEV_JWT_SECRET;

  if (isProduction && announcedIp === "127.0.0.1") {
    throw new Error("ANNOUNCED_IP must be set to the server's public IP in production");
  }

  if (isProduction && (!process.env.JWT_SECRET || jwtSecret === DEV_JWT_SECRET)) {
    throw new Error("JWT_SECRET must be set to a strong value in production");
  }

  return {
    nodeEnv,
    isProduction,
    port: Number(process.env.PORT || 4100),
    announcedIp,
    jwtSecret,
  };
}
