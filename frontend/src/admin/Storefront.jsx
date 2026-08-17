import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { compressImage } from "../imageCompress";

/**
 * Landing-page hero editor.
 *
 * The admin uploads a photo or a short video; it fills the full width of the
 * storefront banner. Framing is non-destructive: drag the media to reposition
 * and use the zoom slider to crop in — the focal point and zoom are stored and
 * replayed on the storefront, which also means the same controls work for
 * video, where a real crop isn't possible in the browser.
 */
export default function Storefront() {
  const [hero, setHero] = useState(null); // { url, media_type, x, y, zoom }
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const frameRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    api
      .hero()
      .then(({ hero }) => setHero(hero))
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  }, []);

  async function onUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setNotice("");
    setUploading(true);
    try {
      const isVideo = file.type.startsWith("video/");
      const payload = isVideo ? file : await compressImage(file);
      const { url, media_type } = await api.admin.uploadHeroMedia(payload);
      setHero({ url, media_type, x: 50, y: 50, zoom: 1 });
      setDirty(true);
      setNotice("Uploaded — drag to position, zoom to crop, then save.");
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function startDrag(e) {
    if (!hero) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, x: hero.x, y: hero.y };
    window.addEventListener("pointermove", onDrag);
    window.addEventListener("pointerup", endDrag, { once: true });
  }

  function onDrag(e) {
    const d = dragRef.current;
    const frame = frameRef.current;
    if (!d || !frame) return;
    const { width, height } = frame.getBoundingClientRect();
    // Dragging right shows more of the media's left side: focal point moves opposite.
    const nx = d.x - ((e.clientX - d.startX) / width) * 100;
    const ny = d.y - ((e.clientY - d.startY) / height) * 100;
    setHero((h) => ({ ...h, x: Math.min(100, Math.max(0, nx)), y: Math.min(100, Math.max(0, ny)) }));
    setDirty(true);
  }

  function endDrag() {
    dragRef.current = null;
    window.removeEventListener("pointermove", onDrag);
  }

  function setZoom(zoom) {
    setHero((h) => ({ ...h, zoom: Number(zoom) }));
    setDirty(true);
  }

  async function save() {
    setError("");
    setSaving(true);
    try {
      await api.admin.saveHero(hero);
      setDirty(false);
      setNotice("Saved — the landing page now shows this.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setError("");
    setSaving(true);
    try {
      await api.admin.saveHero({ url: null });
      setHero(null);
      setDirty(false);
      setNotice("Removed — the landing page shows the default banner again.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const mediaStyle = hero
    ? {
        objectPosition: `${hero.x}% ${hero.y}%`,
        transform: `scale(${hero.zoom})`,
        transformOrigin: `${hero.x}% ${hero.y}%`,
      }
    : undefined;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Storefront</h1>
          <p>The photo or video shown across the landing-page banner.</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && !error && <div className="alert alert-ok">{notice}</div>}

      <div className="admin-panel hero-editor">
        {!loaded ? (
          <div className="spinner">Loading…</div>
        ) : (
          <>
            <div
              className={`hero-edit-frame ${hero ? "has-media" : ""}`}
              ref={frameRef}
              onPointerDown={startDrag}
              role="img"
              aria-label={hero ? "Hero media preview — drag to reposition" : "No hero media set"}
            >
              {hero ? (
                hero.media_type === "video" ? (
                  <video src={hero.url} style={mediaStyle} autoPlay muted loop playsInline />
                ) : (
                  <img src={hero.url} style={mediaStyle} alt="" draggable={false} />
                )
              ) : (
                <span className="hero-edit-empty">No banner media — the default gradient shows.</span>
              )}
            </div>

            <div className="hero-edit-controls">
              <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>
                {uploading ? "Uploading…" : hero ? "Replace photo / video" : "Upload photo / video"}
                <input
                  type="file"
                  accept="image/*,video/mp4,video/webm,video/quicktime"
                  hidden
                  onChange={onUpload}
                  disabled={uploading}
                />
              </label>

              {hero && (
                <>
                  <div className="hero-zoom">
                    <label htmlFor="hero-zoom">Zoom (crop in)</label>
                    <input
                      id="hero-zoom"
                      type="range"
                      min="1"
                      max="3"
                      step="0.05"
                      value={hero.zoom}
                      onChange={(e) => setZoom(e.target.value)}
                    />
                  </div>
                  <p className="hero-hint">
                    Drag the preview to position it. What you frame here is what shoppers see
                    behind the headline.
                  </p>
                  <div className="tools">
                    <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || !dirty}>
                      {saving ? "Saving…" : dirty ? "Save framing" : "Saved"}
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={remove} disabled={saving}>
                      Remove media
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
