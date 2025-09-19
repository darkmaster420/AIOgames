import mongoose from 'mongoose';

const jobSchema = new mongoose.Schema({
  downloader: { type: String, required: true },
  external_id: { type: String, required: true },
  name: String,
  url: String,
  status: String,
  progress: Number,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update timestamps on save
jobSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const Job = mongoose.model('Job', jobSchema);

export async function addJob({ downloader, external_id, name, url, status, progress }) {
  const job = new Job({
    downloader,
    external_id,
    name,
    url,
    status,
    progress: progress || 0
  });
  return await job.save();
}

export async function updateJob({ external_id, downloader, status, progress, name }) {
  return await Job.findOneAndUpdate(
    { external_id, downloader },
    { status, progress, name, updatedAt: new Date() },
    { new: true, upsert: true }
  );
}

export async function getAllJobs() {
  return await Job.find().sort({ createdAt: -1 }).exec();
}

export async function getJobByExternal(downloader, external_id) {
  return await Job.findOne({ downloader, external_id }).exec();
}