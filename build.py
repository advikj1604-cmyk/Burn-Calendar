"""Assemble the single-file app: python3 build.py [data/your_dataset.json]
Writes index.html with the code, the dataset and the country outlines inside it."""
import sys, os
here = os.path.dirname(os.path.abspath(__file__))
rd = lambda p: open(os.path.join(here, p), encoding="utf-8").read()
data = rd(sys.argv[1] if len(sys.argv) > 1 else "data/demo.json")
safe = lambda s: s.replace("</", "<\\/")
html = rd("src/template.html")
for tag, body in (("/*DATA*/", safe(data)), ("/*WORLD*/", safe(rd("src/world_outline.json"))), ("/*STATES*/", safe(rd("src/india_states.json"))),
                  ("/*CORE*/", rd("src/core.js").replace("</script", "<\\/script")), ("/*APP*/", rd("src/app.js").replace("</script", "<\\/script"))):
    assert tag in html; html = html.replace(tag, body, 1)
open(os.path.join(here, "index.html"), "w", encoding="utf-8").write(html)
print("index.html", len(html) // 1024, "KB")
