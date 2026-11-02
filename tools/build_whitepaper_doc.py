"""Build the product white paper DOCX from docs/产品白皮书.md with real prototype screenshots."""
from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt
from docx.oxml.ns import qn

root = Path(__file__).resolve().parents[1]
md_path = root / 'docs' / '产品白皮书.md'
shots = root / 'docs' / '对标快照'
out = root / 'docs' / '产品白皮书-2026-11-02c.docx'

document = Document()
style = document.styles['Normal']
style.font.name = 'Microsoft YaHei'
style.font.size = Pt(10.5)
style.element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')

SHOT_ORDER = [
    ('local-login.png', '登录页：居中布局，下方提供免登录示例入口'),
    ('local-dashboard.png', '仪表盘：三张行动卡与最近方案表格'),
    ('local-workflow.png', '广告工作台：五步状态、成本显示、指标解读与动作结论'),
    ('yicopy-tools.png', 'YICOPY 免费工具页（公开页面快照）'),
    ('yicopy-traffic-structure.png', 'YICOPY 查流量结构工具页（公开页面快照）'),
]

for line in md_path.read_text(encoding='utf-8').splitlines():
    text = line.strip()
    if not text:
        continue
    if text.startswith('## '):
        document.add_heading(text[3:], level=1)
    elif text.startswith('# '):
        document.add_heading(text[2:], level=0)
    elif text.startswith('- '):
        document.add_paragraph(text[2:], style='List Bullet')
    elif text[:2].isdigit() and text[1:3] == '. ':
        document.add_paragraph(text[3:], style='List Number')
    else:
        document.add_paragraph(text)

document.add_heading('原型截图（本地服务真实页面）', level=1)
for name, caption in SHOT_ORDER:
    image = shots / name
    if not image.exists():
        continue
    document.add_paragraph(caption)
    document.add_picture(str(image), width=Inches(6.0))

document.save(out)
check = Document(out)
assert len(check.inline_shapes) >= 3, 'screenshots missing'
assert '尚未验证' in '\n'.join(p.text for p in check.paragraphs)
print('white paper built:', out.name, 'images:', len(check.inline_shapes))
