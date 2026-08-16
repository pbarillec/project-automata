class_name MilestoneConfig
extends RefCounted

var level: int
var production_multiplier: float


func _init(p_level: int = 0, p_production_multiplier: float = 1.0) -> void:
	level = p_level
	production_multiplier = p_production_multiplier
