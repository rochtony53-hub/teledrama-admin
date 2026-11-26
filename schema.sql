CREATE TABLE IF NOT EXISTS dramas(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,synopsis TEXT DEFAULT '',poster TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS episodes(id INTEGER PRIMARY KEY AUTOINCREMENT,drama_id INTEGER NOT NULL,num INTEGER DEFAULT 1,title TEXT DEFAULT '',file_id TEXT NOT NULL,views INTEGER DEFAULT 0);
-- Les colonnes supplementaires (genre, annee, note, duree...) sont ajoutees automatiquement par l'API.
