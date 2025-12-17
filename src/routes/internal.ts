import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadConfig } from "../config";
import { registerEpisodeAssetSchema } from "../schemas/episode-assets";
import {
  CatalogService,
  CatalogServiceError,
} from "../services/catalog-service";
import { viewerFeedItemSchema } from "../schemas/viewer-catalog";
import {
  engagementMetricsEventSchema,
  mediaProcessedEventSchema,
} from "../schemas/events";
import { ViewerCatalogService } from "../services/viewer-catalog-service";
import { getRedis } from "../lib/redis";
import { TrendingService } from "../services/trending-service";
import { RedisCatalogEventsPublisher } from "../services/catalog-events";

export default fp(async function internalRoutes(fastify: FastifyInstance) {
  const config = loadConfig();
  const redis = getRedis();
  const eventsPublisher = new RedisCatalogEventsPublisher(
    redis,
    config.CATALOG_EVENT_STREAM_KEY
  );
  const trendingService = new TrendingService(redis, {
    trendingKey: config.TRENDING_SORTED_SET_KEY,
    ratingsKey: config.RATINGS_HASH_KEY,
  });
  const catalog = new CatalogService({
    defaultOwnerId: config.DEFAULT_OWNER_ID,
    eventsPublisher,
  });
  const viewerCatalog = new ViewerCatalogService({
    feedCacheTtlSeconds: config.FEED_CACHE_TTL_SECONDS,
    seriesCacheTtlSeconds: config.SERIES_CACHE_TTL_SECONDS,
    relatedCacheTtlSeconds: config.RELATED_CACHE_TTL_SECONDS,
    redis,
    trending: trendingService,
  });
  const systemActorId = "SYSTEM";

  fastify.get("/videos/:id", {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: viewerFeedItemSchema,
      },
    },
    handler: async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const metadata = await viewerCatalog.getEpisodeMetadata(params.id);
      if (!metadata) {
        throw fastify.httpErrors.notFound("Episode not found");
      }
      return metadata;
    },
  });

  fastify.get("/catalog/categories/:id", {
    schema: {
      params: z.object({ id: z.string().uuid() }),
    },
    handler: async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      try {
        const category = await catalog.getCategoryById(params.id);
        return category;
      } catch (error) {
        if (
          error instanceof CatalogServiceError &&
          error.code === "NOT_FOUND"
        ) {
          throw fastify.httpErrors.notFound("Category not found");
        }
        request.log.error({ err: error }, "Failed to fetch category");
        throw fastify.httpErrors.internalServerError(
          "Unable to fetch category"
        );
      }
    },
  });

  fastify.get("/catalog/media/:id", {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: viewerFeedItemSchema,
      },
    },
    handler: async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const metadata = await viewerCatalog.getEpisodeMetadata(params.id);
      if (!metadata) {
        throw fastify.httpErrors.notFound("Media not found");
      }
      return metadata;
    },
  });

  fastify.post<{
    Params: { id: string };
  }>("/catalog/episodes/:id/assets", {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: registerEpisodeAssetSchema,
    },
    handler: async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = registerEpisodeAssetSchema.parse(request.body);
      try {
        const result = await catalog.registerEpisodeAsset(systemActorId, {
          episodeId: params.id,
          ...body,
        });
        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof CatalogServiceError) {
          if (error.code === "NOT_FOUND") {
            return reply.status(404).send({ message: error.message });
          }
          if (error.code === "FAILED_PRECONDITION") {
            return reply.status(412).send({ message: error.message });
          }
        }
        request.log.error(
          { err: error, episodeId: params.id },
          "Failed to register episode asset via internal route"
        );
        return reply
          .status(500)
          .send({ message: "Unable to register episode asset" });
      }
    },
  });

  fastify.post("/events/media-processed", {
    schema: {
      body: mediaProcessedEventSchema,
    },
    handler: async (request, reply) => {
      const body = mediaProcessedEventSchema.parse(request.body);
      try {
        await catalog.registerEpisodeAsset(systemActorId, {
          episodeId: body.episodeId,
          status: body.status,
          sourceUploadId: body.sourceUploadId ?? null,
          streamingAssetId: body.streamingAssetId ?? null,
          manifestUrl: body.manifestUrl ?? null,
          defaultThumbnailUrl: body.defaultThumbnailUrl ?? null,
          variants: body.variants,
        });
        return reply.status(202).send({ accepted: true });
      } catch (error) {
        if (error instanceof CatalogServiceError) {
          if (error.code === "NOT_FOUND") {
            return reply.status(404).send({ message: error.message });
          }
          if (error.code === "FAILED_PRECONDITION") {
            return reply.status(412).send({ message: error.message });
          }
        }
        request.log.error(
          { err: error, episodeId: body.episodeId },
          "Failed to process media event"
        );
        return reply
          .status(500)
          .send({ message: "Unable to apply media processed event" });
      }
    },
  });

  fastify.post("/events/engagement/metrics", {
    schema: {
      body: engagementMetricsEventSchema,
    },
    handler: async (request, reply) => {
      const body = engagementMetricsEventSchema.parse(request.body);
      try {
        await trendingService.applyMetrics(body.metrics);
        return reply.status(202).send({ accepted: true });
      } catch (error) {
        request.log.error({ err: error }, "Failed to apply engagement metrics");
        return reply
          .status(500)
          .send({ message: "Unable to persist engagement metrics" });
      }
    },
  });
});
