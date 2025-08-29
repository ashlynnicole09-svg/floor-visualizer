# Floor Visualizer (Static, GitHub Pages)

A no-login, client‑side flooring visualizer you can host on GitHub Pages. Upload a room photo, mark the floor plane with 4 points, and try different floor textures with realistic perspective and adjustable plank size, angle, and opacity. Export a PNG or save/load sessions.

## Features
- 100% static (HTML/CSS/JS) — no server required
- WebGL‑based perspective‑correct tiling on a 4‑point floor polygon
- Upload or choose a texture (auto power‑of‑two resize for seamless repeating)
- Measure tool to set real‑world scale (pixels per inch)
- Controls: plank length/width (inches), angle, opacity, exposure, contrast
- Export composite image as PNG
- Save/Load session JSON

## File structure
```
index.html
styles.css
app.js
assets/textures/
  oak_light.png
  oak_warm.png
  walnut_dark.png
  stone_grey.png
```

## How to deploy on GitHub Pages
1. **Create a new repo** on GitHub (e.g., `floor-visualizer`).
2. **Upload these files** (drag‑and‑drop the entire folder or upload the ZIP and extract).
3. Go to **Settings → Pages**.
   - **Source:** Select `Deploy from a branch`
   - **Branch:** choose `main` (or `master`) and `/ (root)`
   - Click **Save**.
4. Wait a minute, then open: `https://YOUR_USERNAME.github.io/floor-visualizer/`

### Custom domain (optional)
- Add a DNS CNAME record for your domain pointing to `YOUR_USERNAME.github.io`.
- In the repo, create a file named **CNAME** (no extension) containing your domain (e.g., `corbinsflooringoutlet.com`).
- In **Settings → Pages**, set your custom domain and enable HTTPS.

## Adding your own textures
- Prepare **seamless** square images (512×512 or 1024×1024) for best results.
- Put them in `assets/textures/` and add preview tiles to the grid in `index.html` (see `DEMO_TEXTURES` in `app.js`). You can also use the **Upload Texture** control ad‑hoc for testing.

## Usage tips
- Place the 4 points **clockwise** around the visible floor.
- Use the **Measure Tool** to set scale using a known dimension (like a 36″ door width).
- Adjust **Angle** to try diagonal installs.
- Tweak **Opacity** to blend the floor with lighting/reflections in the photo.

## Notes
- This MVP supports a 4‑corner floor. For more complex shapes, you can split the floor into multiple quads (duplicate the visualizer or extend the code with triangulation).
- For perfect realism, supply high‑quality seamless textures. The app resamples non‑power‑of‑two textures internally to enable GL repeating.

Enjoy!
