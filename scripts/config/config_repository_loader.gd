class_name ConfigRepositoryLoader
extends RefCounted

const JsonConfigLoaderScript := preload("res://scripts/config/json_config_loader.gd")
const ConfigValidationResultScript := preload("res://scripts/config/config_validation_result.gd")
const GameConfigRepositoryScript := preload("res://scripts/config/game_config_repository.gd")
const EraConfigScript := preload("res://scripts/config/era_config.gd")
const ProducerConfigScript := preload("res://scripts/config/producer_config.gd")
const MilestoneConfigScript := preload("res://scripts/config/milestone_config.gd")

const REQUIRED_FILE_KEYS := ["eras", "producers", "milestones"]


static func load_from_manifest_path(manifest_path: String) -> ConfigValidationResult:
	var result: ConfigValidationResult = ConfigValidationResultScript.new()
	var manifest_data = JsonConfigLoaderScript.load_json_file(manifest_path, result)
	if result.has_errors():
		return result

	var resolved_files := _validate_manifest_structure(manifest_path, manifest_data, result)
	if result.has_errors():
		return result

	var raw_documents := {}
	for key in REQUIRED_FILE_KEYS:
		var file_path: String = resolved_files[key]
		raw_documents[key] = JsonConfigLoaderScript.load_json_file(file_path, result)
	if result.has_errors():
		return result

	_validate_document_structure(manifest_data, raw_documents, resolved_files, result)
	if result.has_errors():
		return result

	_validate_cross_references(raw_documents, resolved_files, result)
	if result.has_errors():
		return result

	_validate_semantics(manifest_data, raw_documents, resolved_files, result)
	if result.has_errors():
		return result

	result.repository = _build_repository(manifest_data, raw_documents)
	return result


static func _validate_manifest_structure(
		manifest_path: String,
		manifest_data: Variant,
		result
) -> Dictionary:
	var resolved_files := {}
	if not _is_dictionary(manifest_data):
		result.add_error("structural", manifest_path, "Config manifest root must be a JSON object.")
		return resolved_files

	_require_int(manifest_data, "schemaVersion", manifest_path, result, 1)
	_require_string(manifest_data, "gameVersion", manifest_path, result)
	_require_int(manifest_data, "saveVersion", manifest_path, result, 1)
	_require_string(manifest_data, "contentVersion", manifest_path, result)
	_require_string(manifest_data, "economyVersion", manifest_path, result)
	if not _require_dictionary(manifest_data, "files", manifest_path, result):
		return resolved_files

	var files: Dictionary = manifest_data["files"]
	for key in REQUIRED_FILE_KEYS:
		if _require_string(files, key, manifest_path + ".files", result):
			resolved_files[key] = _resolve_path(manifest_path, files[key])
	return resolved_files


static func _validate_document_structure(
		manifest: Dictionary,
		raw_documents: Dictionary,
		resolved_files: Dictionary,
		result
) -> void:
	_validate_collection_document(raw_documents["eras"], resolved_files["eras"], "eras", result)
	_validate_collection_document(raw_documents["producers"], resolved_files["producers"], "producers", result)
	_validate_collection_document(raw_documents["milestones"], resolved_files["milestones"], "milestones", result)

	if result.has_errors():
		return

	for key in REQUIRED_FILE_KEYS:
		var doc: Dictionary = raw_documents[key]
		var source_path: String = resolved_files[key]
		_require_int(doc, "schemaVersion", source_path, result, 1)
		_require_string(doc, "economyVersion", source_path, result)
		if doc.has("economyVersion") and manifest.has("economyVersion") and doc["economyVersion"] != manifest["economyVersion"]:
			result.add_error(
				"structural",
				source_path,
				"economyVersion '%s' must match manifest economyVersion '%s'." % [doc["economyVersion"], manifest["economyVersion"]]
			)

	for index in range(raw_documents["eras"]["eras"].size()):
		var item = raw_documents["eras"]["eras"][index]
		var item_path := "%s.eras[%d]" % [resolved_files["eras"], index]
		if not _is_dictionary(item):
			result.add_error("structural", item_path, "Era entry must be a JSON object.")
			continue
		_require_string(item, "id", item_path, result)
		_require_string(item, "displayName", item_path, result)
		_require_int(item, "order", item_path, result)

	for index in range(raw_documents["producers"]["producers"].size()):
		var item = raw_documents["producers"]["producers"][index]
		var item_path := "%s.producers[%d]" % [resolved_files["producers"], index]
		if not _is_dictionary(item):
			result.add_error("structural", item_path, "Producer entry must be a JSON object.")
			continue
		_require_string(item, "id", item_path, result)
		_require_string(item, "displayName", item_path, result)
		_require_string(item, "eraId", item_path, result)
		_require_number(item, "baseCost", item_path, result)
		_require_number(item, "costGrowth", item_path, result)
		_require_number(item, "baseProductionPerLevel", item_path, result)
		_require_int(item, "sortOrder", item_path, result)

	for index in range(raw_documents["milestones"]["milestones"].size()):
		var item = raw_documents["milestones"]["milestones"][index]
		var item_path := "%s.milestones[%d]" % [resolved_files["milestones"], index]
		if not _is_dictionary(item):
			result.add_error("structural", item_path, "Milestone entry must be a JSON object.")
			continue
		_require_int(item, "level", item_path, result, 1)
		_require_number(item, "productionMultiplier", item_path, result)


static func _validate_collection_document(
		document_data: Variant,
		source_path: String,
		collection_key: String,
		result
) -> void:
	if not _is_dictionary(document_data):
		result.add_error("structural", source_path, "%s root must be a JSON object." % collection_key)
		return
	_require_array(document_data, collection_key, source_path, result)


static func _validate_cross_references(raw_documents: Dictionary, resolved_files: Dictionary, result) -> void:
	var era_ids := _validate_unique_ids(raw_documents["eras"]["eras"], resolved_files["eras"], "eras", result)
	_validate_unique_ids(raw_documents["producers"]["producers"], resolved_files["producers"], "producers", result)

	var milestone_levels := {}
	for index in range(raw_documents["milestones"]["milestones"].size()):
		var milestone: Dictionary = raw_documents["milestones"]["milestones"][index]
		var level: int = milestone["level"]
		if milestone_levels.has(level):
			result.add_error(
				"cross-reference",
				"%s.milestones[%d].level" % [resolved_files["milestones"], index],
				"Duplicate milestone level '%d'; first defined at milestones[%d]." % [level, milestone_levels[level]]
			)
		else:
			milestone_levels[level] = index

	for index in range(raw_documents["producers"]["producers"].size()):
		var producer: Dictionary = raw_documents["producers"]["producers"][index]
		var era_id: String = producer["eraId"]
		if not era_ids.has(era_id):
			result.add_error(
				"cross-reference",
				"%s.producers[%d].eraId" % [resolved_files["producers"], index],
				"Unknown eraId '%s' referenced by producer '%s'." % [era_id, producer["id"]]
			)


static func _validate_semantics(
		_manifest: Dictionary,
		raw_documents: Dictionary,
		resolved_files: Dictionary,
		result
) -> void:
	for index in range(raw_documents["eras"]["eras"].size()):
		var era: Dictionary = raw_documents["eras"]["eras"][index]
		if int(era["order"]) < 0:
			result.add_error("semantic", "%s.eras[%d].order" % [resolved_files["eras"], index], "Era order must be zero or greater.")

	for index in range(raw_documents["producers"]["producers"].size()):
		var producer: Dictionary = raw_documents["producers"]["producers"][index]
		var item_path := "%s.producers[%d]" % [resolved_files["producers"], index]
		if float(producer["baseCost"]) <= 0.0:
			result.add_error("semantic", item_path + ".baseCost", "baseCost must be greater than 0.")
		if float(producer["costGrowth"]) <= 1.0:
			result.add_error("semantic", item_path + ".costGrowth", "costGrowth must be greater than 1.")
		if float(producer["baseProductionPerLevel"]) <= 0.0:
			result.add_error("semantic", item_path + ".baseProductionPerLevel", "baseProductionPerLevel must be greater than 0.")
		if int(producer["sortOrder"]) < 0:
			result.add_error("semantic", item_path + ".sortOrder", "sortOrder must be zero or greater.")

	var previous_level := 0
	for index in range(raw_documents["milestones"]["milestones"].size()):
		var milestone: Dictionary = raw_documents["milestones"]["milestones"][index]
		var item_path := "%s.milestones[%d]" % [resolved_files["milestones"], index]
		var level: int = milestone["level"]
		if level <= 0:
			result.add_error("semantic", item_path + ".level", "Milestone level must be greater than 0.")
		if float(milestone["productionMultiplier"]) <= 0.0:
			result.add_error("semantic", item_path + ".productionMultiplier", "productionMultiplier must be greater than 0.")
		if previous_level > 0 and level <= previous_level:
			result.add_error("semantic", item_path + ".level", "Milestone levels must be in ascending order.")
		previous_level = level


static func _build_repository(manifest: Dictionary, raw_documents: Dictionary) -> GameConfigRepository:
	var repository: GameConfigRepository = GameConfigRepositoryScript.new()
	repository.schema_version = int(manifest["schemaVersion"])
	repository.game_version = manifest["gameVersion"]
	repository.save_version = int(manifest["saveVersion"])
	repository.content_version = manifest["contentVersion"]
	repository.economy_version = manifest["economyVersion"]

	for era_data in raw_documents["eras"]["eras"]:
		var era := EraConfigScript.new(era_data["id"], era_data["displayName"], int(era_data["order"]))
		repository.eras.append(era)
		repository.eras_by_id[era.id] = era

	for producer_data in raw_documents["producers"]["producers"]:
		var producer := ProducerConfigScript.new(
			producer_data["id"],
			producer_data["displayName"],
			producer_data["eraId"],
			float(producer_data["baseCost"]),
			float(producer_data["costGrowth"]),
			float(producer_data["baseProductionPerLevel"]),
			int(producer_data["sortOrder"])
		)
		repository.producers.append(producer)
		repository.producers_by_id[producer.id] = producer

	for milestone_data in raw_documents["milestones"]["milestones"]:
		repository.milestones.append(MilestoneConfigScript.new(
			int(milestone_data["level"]),
			float(milestone_data["productionMultiplier"])
		))

	return repository


static func _validate_unique_ids(items: Array, source_path: String, collection_key: String, result) -> Dictionary:
	var ids := {}
	for index in range(items.size()):
		var item: Dictionary = items[index]
		var id: String = item["id"]
		if ids.has(id):
			result.add_error(
				"cross-reference",
				"%s.%s[%d].id" % [source_path, collection_key, index],
				"Duplicate id '%s'; first defined at %s[%d]." % [id, collection_key, ids[id]]
			)
		else:
			ids[id] = index
	return ids


static func _require_string(source: Dictionary, key: String, path: String, result) -> bool:
	if not source.has(key):
		result.add_error("structural", path + "." + key, "Missing required string field '%s'." % key)
		return false
	if typeof(source[key]) != TYPE_STRING or String(source[key]).strip_edges().is_empty():
		result.add_error("structural", path + "." + key, "Field '%s' must be a non-empty string." % key)
		return false
	return true


static func _require_int(source: Dictionary, key: String, path: String, result, minimum: int = -2147483648) -> bool:
	if not source.has(key):
		result.add_error("structural", path + "." + key, "Missing required integer field '%s'." % key)
		return false
	var value_type := typeof(source[key])
	if value_type != TYPE_INT and not _is_integral_float(source[key]):
		result.add_error("structural", path + "." + key, "Field '%s' must be an integer." % key)
		return false
	source[key] = int(source[key])
	if int(source[key]) < minimum:
		result.add_error("structural", path + "." + key, "Field '%s' must be at least %d." % [key, minimum])
		return false
	return true


static func _require_number(source: Dictionary, key: String, path: String, result) -> bool:
	if not source.has(key):
		result.add_error("structural", path + "." + key, "Missing required number field '%s'." % key)
		return false
	var value_type := typeof(source[key])
	if value_type != TYPE_INT and value_type != TYPE_FLOAT:
		result.add_error("structural", path + "." + key, "Field '%s' must be a number." % key)
		return false
	return true


static func _require_dictionary(source: Dictionary, key: String, path: String, result) -> bool:
	if not source.has(key):
		result.add_error("structural", path + "." + key, "Missing required object field '%s'." % key)
		return false
	if not _is_dictionary(source[key]):
		result.add_error("structural", path + "." + key, "Field '%s' must be an object." % key)
		return false
	return true


static func _require_array(source: Dictionary, key: String, path: String, result) -> bool:
	if not source.has(key):
		result.add_error("structural", path + "." + key, "Missing required array field '%s'." % key)
		return false
	if typeof(source[key]) != TYPE_ARRAY:
		result.add_error("structural", path + "." + key, "Field '%s' must be an array." % key)
		return false
	return true


static func _is_dictionary(value: Variant) -> bool:
	return typeof(value) == TYPE_DICTIONARY


static func _is_integral_float(value: Variant) -> bool:
	if typeof(value) != TYPE_FLOAT:
		return false
	var float_value: float = value
	if is_nan(float_value) or is_inf(float_value):
		return false
	return float_value == floor(float_value)


static func _resolve_path(manifest_path: String, configured_path: String) -> String:
	if configured_path.begins_with("res://") or configured_path.begins_with("user://"):
		return configured_path
	if configured_path.is_absolute_path():
		return configured_path
	return manifest_path.get_base_dir().path_join(configured_path)
