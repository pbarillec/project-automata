class_name EraConfig
extends RefCounted

var id: String
var display_name: String
var order: int


func _init(p_id: String = "", p_display_name: String = "", p_order: int = 0) -> void:
	id = p_id
	display_name = p_display_name
	order = p_order
