import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(4000),
  AUTHSIGNAL_SECRET_KEY: z.string().min(1, "AUTHSIGNAL_SECRET_KEY is required"),
  AUTHSIGNAL_TENANT_ID: z.string().min(1, "AUTHSIGNAL_TENANT_ID is required"),
  AUTHSIGNAL_API_URL: z.string().default("https://api.authsignal.com/v1"),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  MOBILE_ORIGIN: z.string().default("*"),
  API_BASE_URL: z.string().optional()
});

export const config = ConfigSchema.parse(process.env);
