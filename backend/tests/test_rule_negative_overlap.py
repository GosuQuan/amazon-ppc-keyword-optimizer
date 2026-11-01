"""Potential overlap in rule-generated negatives must remain a review item."""
from app.engine.rules import build_negatives


def test_loss_root_overlapping_good_term_is_marked_for_review():
    st = [{'st': 'cell phone stand', 'cls': '优秀', 'clk': 20, 'mt': 'broad'}]
    roots = [{'type': '亏损', 'tok': 'phone', 'clk': 10, 'spend': 7, 'terms': 2}]
    rows = build_negatives(st, roots, [], {'minClicks': 8}, 20)
    assert len(rows) == 1
    assert rows[0]['type'] == '待复核勿上传'
    assert '优质搜索词' in rows[0]['reason']


def test_unrelated_loss_root_keeps_original_suggestion():
    st = [{'st': 'cell phone stand', 'cls': '优秀', 'clk': 20, 'mt': 'broad'}]
    roots = [{'type': '亏损', 'tok': 'toy', 'clk': 10, 'spend': 7, 'terms': 2}]
    rows = build_negatives(st, roots, [], {'minClicks': 8}, 20)
    assert rows[0]['type'] == '词组否定'
