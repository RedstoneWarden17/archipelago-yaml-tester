# Archipelago YAML Tester — GitHub Pages edition

This version is designed to run entirely as a static GitHub Pages site.

It uses Pyodide to execute CPython in WebAssembly, downloads the Archipelago source at runtime, places the uploaded `.apworld` into Archipelago's normal `worlds/` directory, and calls the real `Generate.mystery_argparse()`, `Generate.main()` and `Main.main()` generation path in the browser.

## GitHub Pages

Put these files in the repository root and enable GitHub Pages for the branch/folder containing `index.html`.

There is no Flask server, Docker container, or Python backend.

## Important limitations

- This is browser-side execution, so generation speed depends on the user's computer.
- Archipelago's normal desktop-only dependencies are not installed. Worlds that require browser-incompatible/native dependencies may fail.
- Runs are performed in one Pyodide process, not 100 separate OS processes. This means this is not equivalent to the original server-side subprocess-isolated runner.
- The site downloads the current Archipelago `main` source when opened. For reproducibility, change `ARCHIPELAGO_ZIP` in `app.js` to a fixed release/commit archive.
- The uploaded APWorld is executable Python code, but it is executed inside the browser's WebAssembly sandbox rather than on a server.
