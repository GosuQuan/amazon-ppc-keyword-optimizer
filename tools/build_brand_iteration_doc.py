from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt
from docx.oxml.ns import qn

root = Path(__file__).resolve().parents[1]
doc = Document()
style = doc.styles['Normal']
style.font.name = 'Microsoft YaHei'
style.font.size = Pt(10)
style.element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
doc.add_heading('关键词优化平台：品牌审核与积分事务记录', 0)
doc.add_paragraph('迭代记录｜2026-11-01｜截图为此前本地原型，不展示本轮新增品牌输入框。')
doc.add_heading('需求与实现', level=1)
doc.add_paragraph('AI 扩词中的品牌可能表示兼容设备。旧版固定品牌名单会误判并隐藏候选。现默认空名单，用户可在当前页面输入需复核的英文或数字品牌；修改输入会清除已合并 AI 结果，需重新运行或导入。模型否定候选在导出中标为待复核。')
doc.add_paragraph('演示充值的查重、积分、账户方案和订单使用同一个 SQLite 写事务。六个并发请求仅一次成功，模拟订单写入失败时余额、流水及方案回滚。演示不涉及真实付款。')
doc.add_heading('模型成本依据与限制', level=1)
doc.add_paragraph('同一保存提示词两次调用：启用默认推理时总计 8065 token，关闭推理时 849 token。两次均返回 12 条扩词，第二次 JSON 可解析；未证明质量等价、人民币成本或广告节省。')
doc.add_heading('既有本地原型截图', level=1)
for name, caption in [('login', '登录页面'), ('dashboard', '工作台仪表盘'), ('points', '积分页面'), ('workflow', '优化工作流')]:
    image = root / 'docs' / '原型截图' / (name + '.png')
    if image.exists():
        doc.add_heading(caption, level=2)
        doc.add_picture(str(image), width=Inches(6.2))
doc.add_heading('待办与验证边界', level=1)
doc.add_paragraph('现有截图非本轮实时截图；品牌配置只在当前页面保留，匹配不证明品牌归属；规则生成的否定词仍需人工审核。未接入真实支付、未上传亚马逊，也未验证广告效果。公开部署前需关闭默认开启的演示充值。')
out = root / 'docs' / '品牌审核与积分事务记录-2026-11-01.docx'
doc.save(out)
check = Document(out)
assert len(check.inline_shapes) == 4
assert '模型成本' in '\n'.join(p.text for p in check.paragraphs)
print('DOCX verified: four existing prototype screenshots')
