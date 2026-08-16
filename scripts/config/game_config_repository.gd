class_name GameConfigRepository
extends RefCounted

var schema_version: int
var game_version: String
var save_version: int
var content_version: String
var economy_version: String

var eras: Array = []
var eras_by_id: Dictionary = {}
var producers: Array = []
var producers_by_id: Dictionary = {}
var milestones: Array = []


func has_era(id: String) -> bool:
	return eras_by_id.has(id)


func get_era(id: String):
	return eras_by_id.get(id)


func has_producer(id: String) -> bool:
	return producers_by_id.has(id)


func get_producer(id: String):
	return producers_by_id.get(id)


func get_milestone_levels() -> Array[int]:
	var levels: Array[int] = []
	for milestone in milestones:
		levels.append(milestone.level)
	return levels
