import { buildApp } from "./app";
import { loadConfig } from "./config";
import { startGrpcServer, stopGrpcServer } from "./grpc/server";
import { disconnectPrisma } from "./lib/prisma";

async function main() {
  const app = await buildApp();
  const config = loadConfig();
  let grpcServer: Awaited<ReturnType<typeof startGrpcServer>> | undefined;

  try {
    await app.listen({ host: config.HTTP_HOST, port: config.HTTP_PORT });
    grpcServer = await startGrpcServer(app);
    app.log.info(
      { http: `${config.HTTP_HOST}:${config.HTTP_PORT}` },
      "ContentService ready"
    );
  } catch (error) {
    app.log.error({ err: error }, "Failed to start ContentService");
    if (grpcServer) {
      await stopGrpcServer(grpcServer);
    }
    await disconnectPrisma();
    await app.close();
    process.exit(1);
  }

  const shutdown = async (signal: NodeJS.Signals) => {
    app.log.info({ signal }, "Shutting down ContentService");
    try {
      if (grpcServer) {
        await stopGrpcServer(grpcServer);
      }
      await disconnectPrisma();
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

void main();
