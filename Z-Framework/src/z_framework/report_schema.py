report_schema = {
    "type": "object",
    "properties": {
        "metadata": {
            "type": "object",
            "properties": {
                "portfolio_name": {"type": "string"},
                "generated_at": {"type": "string"},
                "time_horizon": {"type": "string"},
                "note": {"type": "string"},
            },
            "required": ["portfolio_name", "generated_at", "time_horizon", "note"],
            "additionalProperties": False,
        },
        "portfolio_highlights": {
            "type": "object",
            "properties": {
                "theme_exposure": {
                    "type": "object",
                    "properties": {
                        "score": {"type": "string"},
                        "explanation": {"type": "string"},
                    },
                    "required": ["score", "explanation"],
                    "additionalProperties": False,
                },
                "diversification": {
                    "type": "object",
                    "properties": {
                        "score": {"type": "string"},
                        "explanation": {"type": "string"},
                    },
                    "required": ["score", "explanation"],
                    "additionalProperties": False,
                },
                "concentration": {
                    "type": "object",
                    "properties": {
                        "score": {"type": "string"},
                        "explanation": {"type": "string"},
                    },
                    "required": ["score", "explanation"],
                    "additionalProperties": False,
                },
                "volatility_profile": {
                    "type": "object",
                    "properties": {
                        "score": {"type": "string"},
                        "explanation": {"type": "string"},
                    },
                    "required": ["score", "explanation"],
                    "additionalProperties": False,
                },
            },
            "required": [
                "theme_exposure",
                "diversification",
                "concentration",
                "volatility_profile",
            ],
            "additionalProperties": False,
        },
        "ai_committee_summary": {
            "type": "object",
            "properties": {
                "recommendation": {
                    "type": "object",
                    "properties": {
                        "value": {"type": "string"},
                        "explanation": {"type": "string"},
                    },
                    "required": ["value", "explanation"],
                    "additionalProperties": False,
                },
                "position_size": {
                    "type": "object",
                    "properties": {
                        "value": {"type": "string"},
                        "explanation": {"type": "string"},
                    },
                    "required": ["value", "explanation"],
                    "additionalProperties": False,
                },
                "risk_level": {
                    "type": "object",
                    "properties": {
                        "value": {"type": "string"},
                        "explanation": {"type": "string"},
                    },
                    "required": ["value", "explanation"],
                    "additionalProperties": False,
                },
                "conviction": {
                    "type": "object",
                    "properties": {
                        "value": {"type": "string"},
                        "explanation": {"type": "string"},
                    },
                    "required": ["value", "explanation"],
                    "additionalProperties": False,
                },
                "thesis": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "body": {"type": "string"},
                    },
                    "required": ["title", "body"],
                    "additionalProperties": False,
                },
                "summary_points": {
                    "type": "array",
                    "items": {"type": "string"},
                },
            },
            "required": [
                "recommendation",
                "position_size",
                "risk_level",
                "conviction",
                "thesis",
                "summary_points",
            ],
            "additionalProperties": False,
        },
        "research_agent": {
            "type": "object",
            "properties": {
                "key_insight": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "key_drivers": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "implications": {"type": "string"},
            },
            "required": ["key_insight", "key_drivers", "implications"],
            "additionalProperties": False,
        },
        "quant_agent": {
            "type": "object",
            "properties": {
                "metrics": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "indicators": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "correlation": {
                    "type": "object",
                    "properties": {
                        "summary": {"type": "string"},
                        "interpretation": {"type": "string"},
                    },
                    "required": ["summary", "interpretation"],
                    "additionalProperties": False,
                },
                "concentration": {
                    "type": "object",
                    "properties": {
                        "conclusion": {"type": "string"},
                    },
                    "required": ["conclusion"],
                    "additionalProperties": False,
                },
            },
            "required": ["metrics", "indicators", "correlation", "concentration"],
            "additionalProperties": False,
        },
        "risk_agent": {
            "type": "object",
            "properties": {
                "structural_risks": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "risk_metrics": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "scenario_analysis": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "description": {"type": "string"},
                        },
                        "required": ["label", "description"],
                        "additionalProperties": False,
                    },
                },
                "guardrails": {
                    "type": "array",
                    "items": {"type": "string"},
                },
            },
            "required": [
                "structural_risks",
                "risk_metrics",
                "scenario_analysis",
                "guardrails",
            ],
            "additionalProperties": False,
        },
        "references": {
            "type": "object",
            "properties": {
                "market_data": {"type": "string"},
                "model_assumptions": {"type": "string"},
                "user_inputs": {
                    "type": "object",
                    "properties": {
                        "time_horizon": {"type": "string"},
                        "note": {"type": "string"},
                    },
                    "required": ["time_horizon", "note"],
                    "additionalProperties": False,
                },
            },
            "required": ["market_data", "model_assumptions", "user_inputs"],
            "additionalProperties": False,
        },
    },
    "required": [
        "metadata",
        "portfolio_highlights",
        "ai_committee_summary",
        "research_agent",
        "quant_agent",
        "risk_agent",
        "references",
    ],
    "additionalProperties": False,
}

report_schema["title"] = "investment_report_phase1"
report_schema["description"] = "Frozen Phase 1 implementation contract for live investment report generation."
