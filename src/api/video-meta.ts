import { type ApiConfig } from "../config";
import { getBearerToken, validateJWT } from "../auth";
import { createVideo, deleteVideo, getVideo, getVideos, type Video } from "../db/videos";
import { respondWithJSON } from "./json";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
// import { dbVideoToSignedVideo } from "./videos";
import type { BunRequest } from "bun";

export async function handlerVideoMetaCreate(cfg: ApiConfig, req: Request) {
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const { title, description } = await req.json();
  if (!title || !description) {
    throw new BadRequestError("Missing title or description");
  }

  const video = createVideo(cfg.db, {
    userID,
    title,
    description,
  });

  return respondWithJSON(201, video);
}

export async function handlerVideoMetaDelete(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }
  if (video.userID !== userID) {
    throw new UserForbiddenError("Not authorized to delete this video");
  }

  deleteVideo(cfg.db, videoId);
  return new Response(null, { status: 204 });
}

export async function handlerVideoGet(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  // Generate presigned URL before returning
  // const signedVideo = dbVideoToSignedVideo(cfg, video);
  const videoWithUrl = video.videoURL ? toCloudFrontURL(cfg, video) : video;
  return respondWithJSON(200, videoWithUrl);
}

export async function handlerVideosRetrieve(cfg: ApiConfig, req: Request) {
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const videos = getVideos(cfg.db, userID);
  
  // Generate presigned URLs for all videos before returning
  // const signedVideos = videos.map(video => dbVideoToSignedVideo(cfg, video));
  const videosWithUrls = videos.map(video => video.videoURL ? toCloudFrontURL(cfg, video) : video);
  return respondWithJSON(200, videosWithUrls);
}

function toCloudFrontURL(cfg: ApiConfig, video: Video): Video {
  if (video.videoURL && !video.videoURL.includes("cloudfront.net")) {
    return {
      ...video,
      videoURL: `https://${cfg.s3CfDistribution}/${video.videoURL}`,
    };
  }
  return video;
}