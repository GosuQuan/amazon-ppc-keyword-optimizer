"""Build the white paper and the round archive from the markdown sources."""
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.shared import Pt

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs'
ARCHIVE = DOCS / '迭代留痕'
ARCHIVE.mkdir(exist_ok=True)


def font(run, size=11, bold=False):
    run.font.name = 'Microsoft YaHei'
    run.font.size = Pt(size)
    run.bold = bold
    run._element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')


def add_markdown(document, text):
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line:
            document.add_paragraph('')
            continue
        if line.startswith('# '):
            paragraph = document.add_paragraph()
            font(paragraph.add_run(line[2:]), 18, True)
        elif line.startswith('## '):
            paragraph = document.add_paragraph()
            font(paragraph.add_run(line[3:]), 14, True)
        elif line.startswith('- '):
            paragraph = document.add_paragraph(style='List Bullet')
            font(paragraph.add_run(line[2:]))
        else:
            paragraph = document.add_paragraph()
            font(paragraph.add_run(line))


def build(source, target):
    document = Document()
    add_markdown(document, source.read_text(encoding='utf-8'))
    document.save(target)
    reopened = Document(target)
    text = '\n'.join(paragraph.text for paragraph in reopened.paragraphs)
    if not any(marker in text for marker in ('亚马逊广告优化平台白皮书', '本轮技术思考', '平台需求拆分', '方案直达')):
        raise SystemExit('document missing expected heading: ' + target.name)
    print(target)


round_text = '\n'.join([
    '# 2026-11-01 平台原型留痕',
    '',
    (DOCS / '平台需求拆分.md').read_text(encoding='utf-8'),
    '',
    (DOCS / '本轮技术思考-平台与积分.md').read_text(encoding='utf-8'),
])
build(DOCS / '产品白皮书.md', DOCS / '产品白皮书.docx')
direct = ARCHIVE / '2026-11-01-方案直达.md'
direct.write_text('# 2026-11-01 方案直达\n\n' + (DOCS / '方案直达测试边界.md').read_text(encoding='utf-8') + '\n仪表盘点击方案后，工作台打开同一编号。这样减少从列表再找一次方案的时间。未做浏览器点击验收。\n', encoding='utf-8')
build(direct, ARCHIVE / '2026-11-01-方案直达.docx')
round_source = ARCHIVE / '2026-11-01-平台积分与定价.md'
round_source.write_text(round_text, encoding='utf-8')
build(round_source, ARCHIVE / '2026-11-01-平台积分与定价.docx')
