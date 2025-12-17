import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { loadConfig } from "../../config";
import {
  feedQuerySchema,
  feedResponseSchema,
  seriesDetailParamsSchema,
  seriesDetailResponseSchema,
  relatedSeriesParamsSchema,
  relatedSeriesQuerySchema,
  relatedSeriesResponseSchema,
} from "../../schemas/viewer-catalog";
import { ViewerCatalogService } from "../../services/viewer-catalog-service";
import { getRedis } from "../../lib/redis";
import { TrendingService } from "../../services/trending-service";

export default async function viewerCatalogRoutes(fastify: FastifyInstance) {
  const config = loadConfig();
  const redis = getRedis();
  const trendingService = new TrendingService(redis, {
    trendingKey: config.TRENDING_SORTED_SET_KEY,
    ratingsKey: config.RATINGS_HASH_KEY,
  });
  const viewerCatalog = new ViewerCatalogService({
    feedCacheTtlSeconds: config.FEED_CACHE_TTL_SECONDS,
    seriesCacheTtlSeconds: config.SERIES_CACHE_TTL_SECONDS,
    relatedCacheTtlSeconds: config.RELATED_CACHE_TTL_SECONDS,
    redis,
    trending: trendingService,
  });

  const verifyRequest = async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    await fastify.verifyServiceRequest(request, reply);
  };

  fastify.get("/feed", {
    preHandler: verifyRequest,
    schema: {
      querystring: feedQuerySchema,
      response: {
        200: feedResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const query = feedQuerySchema.parse(request.query);
      const result = await viewerCatalog.getFeed(query);
      reply.header(
        "cache-control",
        `public, max-age=${config.FEED_CACHE_TTL_SECONDS}`
      );
      reply.header("x-cache", result.fromCache ? "hit" : "miss");
      return {
        items: result.items,
        nextCursor: result.nextCursor,
      };
    },
  });

  fastify.get("/series/:slug", {
    preHandler: verifyRequest,
    schema: {
      params: seriesDetailParamsSchema,
      response: {
        200: seriesDetailResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const params = seriesDetailParamsSchema.parse(request.params);
      const result = await viewerCatalog.getSeriesDetail({ slug: params.slug });
      if (!result) {
        return reply.status(404).send({ message: "Series not found" });
      }
      reply.header(
        "cache-control",
        `public, max-age=${config.SERIES_CACHE_TTL_SECONDS}`
      );
      reply.header("x-cache", result.fromCache ? "hit" : "miss");
      return {
        series: result.series,
        seasons: result.seasons,
        standaloneEpisodes: result.standaloneEpisodes,
      };
    },
  });

  fastify.get("/series/:slug/related", {
    preHandler: verifyRequest,
    schema: {
      params: relatedSeriesParamsSchema,
      querystring: relatedSeriesQuerySchema,
      response: {
        200: relatedSeriesResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const params = relatedSeriesParamsSchema.parse(request.params);
      const query = relatedSeriesQuerySchema.parse(request.query);
      const result = await viewerCatalog.getRelatedSeries({
        slug: params.slug,
        limit: query.limit,
      });
      if (!result) {
        return reply.status(404).send({ message: "Series not found" });
      }
      reply.header(
        "cache-control",
        `public, max-age=${config.RELATED_CACHE_TTL_SECONDS}`
      );
      reply.header("x-cache", result.fromCache ? "hit" : "miss");
      return {
        items: result.items,
      };
    },
  });
}
