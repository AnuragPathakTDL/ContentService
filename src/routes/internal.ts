import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "../config";
import {
  contentParamsSchema,
  contentResponseSchema,
  type ContentResponse,
} from "../schemas/content";

function buildStubResponse(
  params: { id: string },
  cdnBaseUrl: string,
  defaultOwnerId: string
): ContentResponse {
  const nowIso = new Date().toISOString();
  const thumbnailBase = `${cdnBaseUrl.replace(/\/$/, "")}/thumbnails/${params.id}`;
  return {
    id: params.id,
    title: `PocketLOL Video ${params.id.substring(0, 8)}`,
    description: "Stub video metadata returned by ContentService",
    durationSeconds: 900,
    ownerId: defaultOwnerId,
    publishedAt: nowIso,
    visibility: "public",
    tags: ["stub", "demo"],
    thumbnails: [
      {
        url: `${thumbnailBase}/default.jpg`,
        width: 1280,
        height: 720,
      },
      {
        url: `${thumbnailBase}/hq.jpg`,
        width: 1920,
        height: 1080,
      },
    ],
    stats: {
      views: 4_250,
      likes: 250,
      comments: 32,
    },
  };
}

export default fp(async function internalRoutes(fastify: FastifyInstance) {
  const config = loadConfig();

  fastify.get("/videos/:id", {
    schema: {
      params: contentParamsSchema,
      response: {
        200: contentResponseSchema,
      },
    },
    handler: async (request) => {
      const params = contentParamsSchema.parse(request.params);
      return buildStubResponse(params, config.CDN_BASE_URL, config.DEFAULT_OWNER_ID);
    },
  });
});
