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
  categoryListQuerySchema,
  categoryListResponseSchema,
} from "../../schemas/viewer-catalog";
import { ViewerCatalogService } from "../../services/viewer-catalog-service";
import {
  CatalogConsistencyError,
  DataQualityMonitor,
} from "../../services/data-quality-monitor";
import { getRedis } from "../../lib/redis";
import { TrendingService } from "../../services/trending-service";

export default async function viewerCatalogRoutes(fastify: FastifyInstance) {
  const config = loadConfig();
  const redis = getRedis();
  const trendingService = new TrendingService(redis, {
    trendingKey: config.TRENDING_SORTED_SET_KEY,
    ratingsKey: config.RATINGS_HASH_KEY,
  });
  const qualityMonitor = new DataQualityMonitor();
  const viewerCatalog = new ViewerCatalogService({
    feedCacheTtlSeconds: config.FEED_CACHE_TTL_SECONDS,
    seriesCacheTtlSeconds: config.SERIES_CACHE_TTL_SECONDS,
    relatedCacheTtlSeconds: config.RELATED_CACHE_TTL_SECONDS,
    redis,
    trending: trendingService,
    qualityMonitor,
  });

  const verifyRequest = async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    await fastify.verifyServiceRequest(request, reply);
  };

  fastify.get("/feed", {
    config: { metricsId: "/catalog/feed" },
    preHandler: verifyRequest,
    schema: {
      querystring: feedQuerySchema,
      response: {
        200: feedResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const query = feedQuerySchema.parse(request.query);
      try {
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
      } catch (error) {
        if (error instanceof CatalogConsistencyError) {
          request.log.error(
            {
              err: error,
              contentId: error.issue.attributes.episodeId,
              issue: error.issue.kind,
            },
            "Catalog data quality failure on viewer feed"
          );
          return reply
            .status(500)
            .send({
              message: "Catalog data quality issue",
              issue: error.issue.kind,
            });
        }
        throw error;
      }
    },
  });

  fastify.get("/series/:slug", {
    config: { metricsId: "/catalog/series/:slug" },
    preHandler: verifyRequest,
    schema: {
      params: seriesDetailParamsSchema,
      response: {
        200: seriesDetailResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const params = seriesDetailParamsSchema.parse(request.params);
      try {
        const result = await viewerCatalog.getSeriesDetail({
          slug: params.slug,
        });
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
      } catch (error) {
        if (error instanceof CatalogConsistencyError) {
          request.log.error(
            {
              err: error,
              contentId: error.issue.attributes.episodeId,
              issue: error.issue.kind,
            },
            "Catalog data quality failure on series detail"
          );
          return reply
            .status(500)
            .send({
              message: "Catalog data quality issue",
              issue: error.issue.kind,
            });
        }
        throw error;
      }
    },
  });

  fastify.get("/series/:slug/related", {
    config: { metricsId: "/catalog/series/:slug/related" },
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
      try {
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
      } catch (error) {
        if (error instanceof CatalogConsistencyError) {
          request.log.error(
            {
              err: error,
              contentId: error.issue.attributes.episodeId,
              issue: error.issue.kind,
            },
            "Catalog data quality failure on related series"
          );
          return reply
            .status(500)
            .send({
              message: "Catalog data quality issue",
              issue: error.issue.kind,
            });
        }
        throw error;
      }
    },
  });

  fastify.get("/categories", {
    config: { metricsId: "/catalog/categories" },
    preHandler: verifyRequest,
    schema: {
      querystring: categoryListQuerySchema,
      response: {
        200: categoryListResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const query = categoryListQuerySchema.parse(request.query);
      const result = await viewerCatalog.listCategories(query);
      reply.header(
        "cache-control",
        `public, max-age=${config.FEED_CACHE_TTL_SECONDS}`
      );
      return result;
    },
  });
}
