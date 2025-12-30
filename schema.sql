CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  original_width INTEGER,
  original_height INTEGER,
  crop_x INTEGER,
  crop_y INTEGER,
  crop_width INTEGER,
  crop_height INTEGER,
  uploaded_at TEXT NOT NULL
);
