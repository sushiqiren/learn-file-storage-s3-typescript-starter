import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import * as path from "path";

// type Thumbnail = {
//   data: Buffer;
//   mediaType: string;
// };

// const videoThumbnails: Map<string, Thumbnail> = new Map();

// export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
//   const { videoId } = req.params as { videoId?: string };
//   if (!videoId) {
//     throw new BadRequestError("Invalid video ID");
//   }

//   const video = getVideo(cfg.db, videoId);
//   if (!video) {
//     throw new NotFoundError("Couldn't find video");
//   }

//   const thumbnail = videoThumbnails.get(videoId);
//   if (!thumbnail) {
//     throw new NotFoundError("Thumbnail not found");
//   }

//   return new Response(thumbnail.data, {
//     headers: {
//       "Content-Type": thumbnail.mediaType,
//       "Cache-Control": "no-store",
//     },
//   });
// }

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  // TODO: implement the upload here
  // Parse the form data
  const formData = await req.formData();
  
  // Get the image data from the form
  const thumbnailFile = formData.get("thumbnail");
  
  // Check if the object is an instance of File
  if (!(thumbnailFile instanceof File)) {
    throw new BadRequestError("Invalid thumbnail file");
  }
  
  // Set maximum upload size to 10MB
  const MAX_UPLOAD_SIZE = 10 << 20; // 10MB
  
  // Check if the file size is within limits
  if (thumbnailFile.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Thumbnail file too large, max size is 10MB");
  }
  
  // Get the media type from the file
  const mediaType = thumbnailFile.type;

  // Validate that the file is either JPEG or PNG
  if (!(mediaType === 'image/jpeg' || mediaType === 'image/png')) {
    throw new BadRequestError("Only JPEG and PNG images are supported");
  }

  // Determine file extension from media type
  let fileExtension = mediaType === 'image/png' ? 'png' : 'jpg';
  
  // Create a unique filename using the videoId
  const filename = `${videoId}.${fileExtension}`;
  
  // Create the full path to save the file
  const filePath = path.join(cfg.assetsRoot, filename);
  
  // Read all image data into an ArrayBuffer
  const arrayBufferData = await thumbnailFile.arrayBuffer();

  // Write the file to disk
  await Bun.write(filePath, arrayBufferData);
  // const data = Buffer.from(arrayBufferData);
  // const base64Data = data.toString("base64");

  // const dataURL = `data:${mediaType};base64,${base64Data}`;
  
  // Get the video's metadata from the database
  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Video not found");
  }
  
  // Check if the authenticated user is the video owner
  if (video.userID !== userID) {
    throw new UserForbiddenError("You don't have permission to update this video's thumbnail");
  }
  
  // Save the thumbnail to the global map
  // videoThumbnails.set(videoId, {
  //   data,
  //   mediaType
  // });
  
  // Generate the thumbnail URL
  // const thumbnailURL = `http://localhost:${cfg.port}/api/thumbnails/${videoId}`;

  // Generate the thumbnail URL that points to the asset server
  const thumbnailURL = `/assets/${filename}`;
  
  // Update the video metadata with the new thumbnail URL
  const updatedVideo = {
    ...video,
    thumbnailURL,
  };
  
  // Update the record in the database
  updateVideo(cfg.db, updatedVideo);
  return respondWithJSON(200, updatedVideo);
}
