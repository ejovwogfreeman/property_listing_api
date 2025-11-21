const cloudinary = require("../config/cloudinary");

// Upload multiple images
const uploadImages = async (files, folder = "default/images") => {
  if (!files || files.length === 0) return [];

  const uploads = files.map(
    (file) =>
      new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            {
              folder,
              resource_type: "image",
              transformation: [{ width: 1600, quality: "auto" }],
            },
            (err, result) => {
              if (err) return reject(err);
              resolve(result.secure_url);
            }
          )
          .end(file.buffer);
      })
  );

  return Promise.all(uploads);
};

// Upload videos (single or multiple)
const uploadVideos = async (files, folder = "default/videos") => {
  if (!files) return [];

  // Ensure files is always an array
  const filesArray = Array.isArray(files) ? files : [files];

  const uploads = filesArray.map(
    (file) =>
      new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            {
              folder,
              resource_type: "video",
              transformation: [{ quality: "auto" }, { height: 720 }],
            },
            (err, result) => {
              if (err) return reject(err);
              resolve(result.secure_url);
            }
          )
          .end(file.buffer);
      })
  );

  return Promise.all(uploads);
};

// Upload multiple "other" files (pdf, docs, excel, etc.)
const uploadOtherFiles = async (files, folder = "default/files") => {
  if (!files || files.length === 0) return [];

  const uploads = files.map(
    (file) =>
      new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            {
              folder,
              resource_type: "raw",
            },
            (err, result) => {
              if (err) return reject(err);
              resolve(result.secure_url);
            }
          )
          .end(file.buffer);
      })
  );

  return Promise.all(uploads);
};

module.exports = {
  uploadImages,
  uploadVideos,
  uploadOtherFiles,
};
