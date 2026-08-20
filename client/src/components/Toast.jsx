/**
 * A floating confirmation ("Saved.") that overlays the page instead of an
 * inline banner pushing content down — the inline `info-box` this replaces
 * was making it awkward to keep editing right after a save. Positioned the
 * same way `.turn-prompt` already is: fixed, off in a corner, out of the way.
 */
export default function Toast({ message }) {
  if (!message) return null;
  return (
    <div className="toast" role="status">
      {message}
    </div>
  );
}
