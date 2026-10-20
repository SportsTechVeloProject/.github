# Code

| Folder | Contents |
|---|---|
| [`website/`](website/) | The V-LO web app: plain HTML, CSS and JavaScript, no build step. `vlo.html` is the app; it connects to the sensors over Web Bluetooth and talks to Supabase. |
| [`analysis/`](analysis/) | The Python analysis that runs on Azure: Madgwick orientation filter, drift correction, rep detection and velocity estimation (`squat/`), plus the Azure Function and Supabase helpers. |
| [`database/`](database/) | SQL for the Supabase database: table changes (`migrations/`), training plans and queries. |

## Run the website locally

```bash
cd code/website
python -m http.server 8080
```

Then open [localhost:8080/vlo.html](http://localhost:8080/vlo.html) in Chrome or Edge.

## Run the analysis locally

```bash
cd code/analysis
pip install -r requirements.txt
```

The analysis needs the Supabase `service_role` key in an environment variable or in `local.settings.json` (copy `local.settings.example.json`). That key is a secret and is never committed.
