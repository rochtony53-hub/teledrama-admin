#!/data/data/com.termux/files/usr/bin/bash
# Decoupe une longue video en episodes et les envoie a l'admin.
# Usage : ./split-upload.sh VIDEO ID_DRAME [SECONDES=120] [N_DEPART=1] [PREFIXE=Episode]
# Prerequis : pkg install ffmpeg curl ; export ADMIN_URL=https://xxx.pages.dev ADMIN_PASSWORD=...
set -e
V="$1"; D="$2"; S="${3:-120}"; N="${4:-1}"; P="${5:-Episode}"; START=$N; MAX=19000000
[ -f "$V" ] && [ -n "$D" ] || { echo "Usage: $0 VIDEO ID_DRAME [SECONDES] [N_DEPART] [PREFIXE]"; exit 1; }
[ -n "$ADMIN_URL" ] && [ -n "$ADMIN_PASSWORD" ] || { echo "Definis ADMIN_URL et ADMIN_PASSWORD (export ...)"; exit 1; }
T=$(curl -s "$ADMIN_URL/api/login" -H 'Content-Type: application/json' -d "{\"password\":\"$ADMIN_PASSWORD\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$T" ] || { echo "Connexion refusee"; exit 1; }
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
echo "Decoupe en segments de ${S}s (sans re-encodage)..."
ffmpeg -loglevel error -i "$V" -map 0:v:0 -map 0:a:0? -c copy -f segment -segment_time "$S" -reset_timestamps 1 "$W/p%04d.mp4"
for f in "$W"/p*.mp4; do
  if [ "$(stat -c %s "$f")" -gt "$MAX" ]; then
    echo "Segment trop lourd, compression..."
    ffmpeg -loglevel error -y -i "$f" -vf "scale=-2:540" -c:v libx264 -preset veryfast -crf 28 -maxrate 900k -bufsize 1800k -c:a aac -b:a 64k -movflags +faststart "$f.enc.mp4" && mv "$f.enc.mp4" "$f"
  fi
  DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" | cut -d. -f1)
  echo "Episode $N (${DUR}s) : envoi..."
  curl -s -f "$ADMIN_URL/api/upload" -H "Authorization: Bearer $T" -F "file=@$f" -F "drama_id=$D" -F "num=$N" -F "title=$P $N" -F "duration=$DUR" >/dev/null || { echo "Echec de l'envoi de l'episode $N"; exit 1; }
  N=$((N+1))
done
echo "Termine : $((N-START)) episodes envoyes."
