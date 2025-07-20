import { rm } from "fs/promises";
import path from "path";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { respondWithJSON } from "./json";
import { uploadVideoToS3 } from "../s3";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { randomBytes } from "crypto";

import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const MAX_UPLOAD_SIZE = 1 << 30;

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
    throw new UserForbiddenError("Not authorized to update this video");
  }

  const formData = await req.formData();
  const file = formData.get("video");
  if (!(file instanceof File)) {
    throw new BadRequestError("Video file missing");
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File exceeds size limit (1GB)");
  }
  if (file.type !== "video/mp4") {
    throw new BadRequestError("Invalid file type, only MP4 is allowed");
  }

  const tempFilePath = path.join("/tmp", `${videoId}.mp4`);
  await Bun.write(tempFilePath, file);

  // Get the aspect ratio of the video file
  const aspectRatio = await getVideoAspectRatio(tempFilePath);
  
  // Add aspect ratio as prefix to the key
  let key = `${aspectRatio}/${videoId}.mp4`;
  
  await uploadVideoToS3(cfg, key, tempFilePath, "video/mp4");

  const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`;
  video.videoURL = videoURL;
  updateVideo(cfg.db, video);

  await Promise.all([rm(tempFilePath, { force: true })]);

  return respondWithJSON(200, video);
}

export async function getVideoAspectRatio(filePath: string): Promise<string> {
  const proc = Bun.spawn({
    cmd: [
      "ffprobe",
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "json",
      filePath
    ],
    stdout: "pipe",
    stderr: "pipe"
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  
  const exitCode = await proc.exited;
  
  if (exitCode !== 0) {
    throw new Error(`ffprobe failed with exit code ${exitCode}: ${stderr}`);
  }

  try {
    const result = JSON.parse(stdout);
    const stream = result.streams?.[0];
    
    if (!stream || !stream.width || !stream.height) {
      throw new Error("Could not extract video dimensions");
    }

    const width = parseInt(stream.width);
    const height = parseInt(stream.height);
    
    // Calculate aspect ratio
    const ratio = width / height;
    
    // Determine aspect ratio category
    if (Math.abs(ratio - (16/9)) < 0.1) {
      return "landscape"; // 16:9
    } else if (Math.abs(ratio - (9/16)) < 0.1) {
      return "portrait"; // 9:16
    } else {
      return "other";
    }
    
  } catch (error) {
    throw new Error(`Failed to parse ffprobe output: ${error}`);
  }
}
