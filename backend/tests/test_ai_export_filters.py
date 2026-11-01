"""AI export omits brand expansions, covered fragments, and conflicting negatives."""
from app.engine.exporter import export_negatives, export_newwords


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


def test_negative_export_skips_conflicts_but_keeps_brand_candidates():
    text = export_negatives([], [
        {'word': 'cell phone', 'cross': '⚠ 与优质数据冲突，不建议否定', 'reason': 'bad'},
        {'word': 'samsung galaxy', 'cross': '竞品品牌，可作为否定候选，仍需确认不会误伤自有词', 'reason': 'brand'},
    ])
    assert 'cell phone' not in text
    assert 'samsung galaxy' in text
    assert '竞品品牌候选' in text
