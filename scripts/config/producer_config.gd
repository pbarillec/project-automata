class_name ProducerConfig
extends RefCounted

var id: String
var display_name: String
var era_id: String
var base_cost: float
var cost_growth: float
var base_production_per_level: float
var sort_order: int


func _init(
		p_id: String = "",
		p_display_name: String = "",
		p_era_id: String = "",
		p_base_cost: float = 0.0,
		p_cost_growth: float = 0.0,
		p_base_production_per_level: float = 0.0,
		p_sort_order: int = 0
) -> void:
	id = p_id
	display_name = p_display_name
	era_id = p_era_id
	base_cost = p_base_cost
	cost_growth = p_cost_growth
	base_production_per_level = p_base_production_per_level
	sort_order = p_sort_order
