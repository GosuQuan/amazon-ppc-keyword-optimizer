"""AI export omits brand expansions, covered fragments, and conflicting negatives."""
from app.engine.exporter import export_negatives, export_newwords, new_word_rows


def test_newword_export_skips_brand_and_covered_terms():
    text = export_newwords([], [
        {'word': 'phone stand for samsung', 'type': 'AI', 'reason': 'x', 'competitorBrand': True},
        {'word': 'cell phone', 'reason': 'y', 'coveredByGood': True},
        {'word': 'existing keyword', 'type': 'AI', 'reason': 'dup', 'exists': True},
        {'word': 'foldable phone stand for desk', 'type': '长尾', 'reason': 'ok'},
    ])
    assert 'samsung' not in text
    assert 'cell phone' not in text
    assert 'existing keyword' not in text
    assert 'foldable phone stand for desk' in text


def test_same_new_keyword_is_exported_once():
    rows = new_word_rows([
        {'st': 'fresh term', 'sug': '新增精准词', 'camp': 'c', 'adg': 'g', 'srcMt': 'broad',
         'sales': 2, 'orders': 1, 'acos': 0.2, 'exists': False},
    ], [{'pair': 'Fresh   Term', 'sales': 9, 'orders': 2, 'evidence': 'combo'}])
    assert [row['src'] for row in rows] == ['搜索词收割']
    text = export_newwords(rows, [{'word': 'fresh term', 'type': 'AI', 'reason': 'again'}])
    assert text.lower().count('fresh term') == 1


def test_negative_export_shows_the_cross_check_in_its_own_column():
    text = export_negatives(
        [{'type': '精准否定', 'word': 'waste term', 'camp': 'c', 'adg': 'g', 'source': '规则',
          'clk': 2, 'spend': 1, 'reason': 'no orders'}],
        [{'word': 'maybe term', 'cross': '仅 AI 建议，需人工复核', 'reason': 'r'}],
    )
    header = text.split('\r\n')[0]
    assert '复核提示' in header
    lines = {line.split(',')[1]: line for line in text.split('\r\n')[1:] if ',' in line}
    assert '规则命中' in lines['waste term']
    assert '仅 AI 建议' in lines['maybe term']


def test_export_advice_follows_report_evidence():
    text = export_newwords(
        [{'word': 'harvested', 'src': '搜索词收割', 'type': '新增精准词', 'camp': 'c', 'adg': 'g',
          'advice': '优先新增', 'note': 'x'}],
        [{'word': 'ordered term', 'reason': 'r', 'reportOrders': 2, 'reportRows': 3},
         {'word': 'seen term', 'reason': 'r', 'reportRows': 1},
         {'word': 'cold term', 'reason': 'r'}],
    )
    lines = {line.split(',')[0]: line for line in text.split('\r\n')}
    assert '优先新增' in lines['harvested']
    assert '优先新增' in lines['ordered term']
    assert '先观察' in lines['seen term']
    assert '待验证' in lines['cold term']


def test_existing_harvest_is_not_exported_as_a_new_keyword():
    text = export_newwords(new_word_rows([
        {'st': 'already', 'sug': '已有精准词：核对出价与预算', 'camp': 'c', 'adg': 'g', 'srcMt': 'broad',
         'sales': 1, 'orders': 1, 'acos': 0.2, 'exists': True},
        {'st': 'fresh term', 'sug': '新增精准词', 'camp': 'c', 'adg': 'g', 'srcMt': 'broad',
         'sales': 2, 'orders': 1, 'acos': 0.2, 'exists': False},
    ], []), [])
    assert 'already' not in text
    assert 'fresh term' in text


def test_ai_negative_already_covered_by_a_rule_is_not_repeated():
    text = export_negatives(
        [{'type': '精准否定', 'word': 'samsung galaxy', 'camp': 'c', 'adg': 'g', 'source': '规则',
          'clk': 3, 'spend': 1.5, 'reason': 'waste'}],
        [{'word': 'Samsung   Galaxy', 'cross': '竞品品牌，可作为否定候选', 'reason': 'brand'},
         {'word': 'samsung galaxy', 'cross': '与规则一致（高置信）', 'reason': 'again'}],
    )
    assert text.lower().count('samsung galaxy') == 1
    assert '规则' in text
    assert 'AI预判' not in text


def test_negative_export_skips_conflicts_but_keeps_brand_candidates():
    text = export_negatives([], [
        {'word': 'cell phone', 'cross': '⚠ 与优质数据冲突，不建议否定', 'reason': 'bad'},
        {'word': 'samsung galaxy', 'cross': '竞品品牌，可作为否定候选，仍需确认不会误伤自有词', 'reason': 'brand'},
    ])
    assert 'cell phone' not in text
    assert 'samsung galaxy' in text
    assert '竞品品牌候选' in text
    assert '待复核勿上传' in text
    assert '精准否定' not in text
