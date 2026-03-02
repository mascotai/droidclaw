import { Hono } from "hono";
import { sessions } from "../ws/sessions.js";

const health = new Hono();

health.get("/", (c) => {
  const stats = sessions.getStats();
  const devices = sessions.getAllDevices().map((d) => ({
    deviceId: d.deviceId.slice(0, 8),
    persistentDeviceId: d.persistentDeviceId?.slice(0, 8),
    userId: d.userId.slice(0, 8),
    connectedAt: d.connectedAt.toISOString(),
    lastPong: new Date(d.lastPong).toISOString(),
    model: d.deviceInfo?.model,
  }));
  return c.json({
    status: "ok",
    connectedDevices: stats.devices,
    rawConnections: devices.length,
    devices,
  });
});

export { health };
