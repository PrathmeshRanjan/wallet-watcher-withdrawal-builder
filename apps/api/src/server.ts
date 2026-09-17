import { existsSync } from "node:fs";
import { resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import { EthersChainGateway } from "./blockchain/gateway.js";
import { createApp } from "./app.js";
import { getConfig } from "./config.js";
import { createDatabase } from "./database/client.js";

const config = getConfig();
const database = createDatabase(config.databasePath);
const gateway = new EthersChainGateway(config.rpcUrl);
const { app, balanceTracker } = await createApp(config, database, gateway);

const webDist = resolve(import.meta.dirname, "../../web/dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/") || request.url.startsWith("/docs")) {
      return reply
        .status(404)
        .send({ error: { code: "NOT_FOUND", message: "Route was not found" } });
    }
    return reply.sendFile("index.html");
  });
}

await app.listen({ host: config.host, port: config.port });
app.log.info(
  { network: "base-sepolia", chainId: 84532, walletCount: config.walletCount },
  "Vaultline is ready",
);
await balanceTracker.start();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down");
  balanceTracker.stop();
  await app.close();
  database.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
