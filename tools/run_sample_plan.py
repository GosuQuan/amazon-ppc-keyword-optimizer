"""Run the shipped Chinese sample report and write a compact plan summary."""
import json
from collections import Counter
from pathlib import Path

from app.workflow.service import build_plan

ROOT = Path(__file__).resolve().parents[1]
raw = (ROOT / "examples" / "亚马逊搜索词报告-示例.csv").read_bytes()
plan = build_plan(raw, None, {"account": "sample", "marketplace": "US", "currency": "USD", "asin": "B0SAMPLE01"}, 25, 50)
actions = plan["actions"]
summary = {
    "source": "examples/亚马逊搜索词报告-示例.csv",
    "context": plan["context"],
    "metrics": plan["metrics"],
    "target_acos": plan["target_acos"],
    "budget": plan["budget"],
    "warnings": plan["warnings"],
    "action_count": len(actions),
    "by_kind": dict(Counter(a["kind"] for a in actions)),
    "exportable": sum(bool(a["exportable"]) for a in actions),
    "actions": [{
        "kind": a["kind"], "keyword": a["keyword"], "campaign": a["campaign"], "ad_group": a["ad_group"],
        "match_type": a["match_type"], "priority": a["priority"], "current_bid": a["current_bid"],
        "proposed_bid": a["proposed_bid"], "reason": a["reason"], "evidence": a["evidence"],
        "exportable": a["exportable"], "blocking_reasons": a["blocking_reasons"],
    } for a in actions],
}
out = ROOT / "docs" / "runs" / "sample-plan.json"
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({
    "metrics": summary["metrics"], "by_kind": summary["by_kind"], "exportable": summary["exportable"],
    "actions": summary["action_count"], "budget": summary["budget"]["daily_total"],
}, ensure_ascii=False))
