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
    if not any(marker in text for marker in ('亚马逊广告优化平台白皮书', '本轮技术思考', '平台需求拆分', '方案直达', '模型提示词', '可核对花费', '积分提示', '积分余额预览', '余额刷新')):
        raise SystemExit('document missing expected heading: ' + target.name)
    print(target)


build(DOCS / '产品白皮书.md', DOCS / '产品白皮书.docx')
prompt = ARCHIVE / '2026-11-01-模型提示词指标.md'
prompt.write_text('# 2026-11-01 模型提示词指标\n\n' + (DOCS / '模型提示词指标测试边界.md').read_text(encoding='utf-8') + '\n这样每次扣积分的模型调用都带上已经算出的指标。未调用真实模型，也未验证生成词的广告效果。\n', encoding='utf-8')
build(prompt, ARCHIVE / '2026-11-01-模型提示词指标.docx')
claim = ARCHIVE / '2026-11-01-列表可核对花费.md'
claim.write_text('# 2026-11-01 列表可核对花费\n\n' + (DOCS / '列表可核对花费测试边界.md').read_text(encoding='utf-8'), encoding='utf-8')
build(claim, ARCHIVE / '2026-11-01-列表可核对花费.docx')
hint = ARCHIVE / '2026-11-01-工作台积分提示.md'
hint.write_text('# 2026-11-01 工作台积分提示\n\n' + (DOCS / '工作台积分提示测试边界.md').read_text(encoding='utf-8') + '\n原型页面截图仍待浏览器扩展确认后补入。\n', encoding='utf-8')
build(hint, ARCHIVE / '2026-11-01-工作台积分提示.docx')
preview = ARCHIVE / '2026-11-01-积分余额预览.md'
preview.write_text('# 2026-11-01 积分余额预览\n\n生成方案前比较当前整数余额和所需积分。不够时提示不足，够时显示扣后余额。余额或价格不是整数时不编造。未做浏览器截图，未调用真实模型。\n', encoding='utf-8')
build(preview, ARCHIVE / '2026-11-01-积分余额预览.docx')
refresh = ARCHIVE / '2026-11-01-余额刷新.md'
refresh.write_text('# 2026-11-01 余额刷新\n\n示例方案、生成方案和导出草稿成功后重新读取余额。刷新失败不撤销已完成的方案或下载。未做浏览器截图，未调用真实模型。\n', encoding='utf-8')
build(refresh, ARCHIVE / '2026-11-01-余额刷新.docx')
