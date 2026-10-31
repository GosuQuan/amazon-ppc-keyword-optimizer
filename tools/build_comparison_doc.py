"""Render the sample-run comparison note as a standalone HTML page."""
import markdown
from pathlib import Path

root = Path(__file__).resolve().parents[1] / "docs"
text = (root / "示例报表实测与YICOPY对照.md").read_text(encoding="utf-8")
body = markdown.markdown(text, extensions=["tables", "fenced_code"])
css = """
body{margin:0;background:#eef3f8;color:#233548;font:16px/1.85 "Microsoft YaHei",system-ui,sans-serif}
main{max-width:980px;margin:32px auto;background:white;padding:40px 48px;border-radius:16px}
h1{font-size:30px;color:#123a59;border-bottom:4px solid #13847c;padding-bottom:16px}
h2{color:#16496b;margin-top:32px}
table{width:100%;border-collapse:collapse;font-size:14px;display:block;overflow:auto}
th,td{border:1px solid #d7e2ee;padding:8px 10px;vertical-align:top}
th{background:#eaf2f8;text-align:left}
a{color:#087e85}
"""
page = (
    "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\">"
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
    "<title>示例报表实测与 YICOPY 对照</title><style>"
    + css
    + "</style><main>"
    + body
    + "</main></html>"
)
(root / "示例报表实测与YICOPY对照.html").write_text(page, encoding="utf-8")
print("html-ok")
