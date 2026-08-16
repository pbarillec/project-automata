extends GutTest

const ConfigRepositoryLoaderScript := preload("res://scripts/config/config_repository_loader.gd")

const TEST_ROOT := "user://automata_config_validation_tests"
const ECONOMY_VERSION := "economy-test"


func before_all() -> void:
	DirAccess.make_dir_recursive_absolute(TEST_ROOT.path_join("economy"))


func test_valid_repository_config_loads_typed_repository() -> void:
	var result: ConfigValidationResult = ConfigRepositoryLoaderScript.load_from_manifest_path("res://data/config_manifest.json")

	assert_false(result.has_errors(), result.to_text())
	assert_not_null(result.repository, "Valid config should produce a typed repository.")
	assert_eq(result.repository.content_version, "aut-003-config-fixture")
	assert_true(result.repository.has_producer("fixture_fabricator"))
	assert_almost_eq(result.repository.get_producer("fixture_fabricator").base_cost, 10.0, 0.001)
	assert_eq(result.repository.get_milestone_levels(), [10])


func test_integer_fields_accept_integral_json_floats_and_store_ints() -> void:
	var documents := _valid_documents()
	documents["eras"]["schemaVersion"] = 1.0
	documents["eras"]["eras"][0]["order"] = 0.0
	documents["producers"]["schemaVersion"] = 1.0
	documents["producers"]["producers"][0]["sortOrder"] = 0.0
	documents["milestones"]["schemaVersion"] = 1.0
	documents["milestones"]["milestones"][0]["level"] = 10.0
	var manifest_path := _write_config_set("integral_float_integer_fields", documents, {
		"schemaVersion": 1.0,
		"saveVersion": 1.0
	})

	var result: ConfigValidationResult = ConfigRepositoryLoaderScript.load_from_manifest_path(manifest_path)

	assert_false(result.has_errors(), result.to_text())
	assert_eq(result.repository.schema_version, 1)
	assert_eq(typeof(result.repository.schema_version), TYPE_INT)
	assert_eq(result.repository.save_version, 1)
	assert_eq(typeof(result.repository.save_version), TYPE_INT)
	assert_eq(result.repository.eras[0].order, 0)
	assert_eq(typeof(result.repository.eras[0].order), TYPE_INT)
	assert_eq(result.repository.producers[0].sort_order, 0)
	assert_eq(typeof(result.repository.producers[0].sort_order), TYPE_INT)
	assert_eq(result.repository.milestones[0].level, 10)
	assert_eq(typeof(result.repository.milestones[0].level), TYPE_INT)


func test_integer_validator_normalizes_integral_float_values() -> void:
	var source := {"value": 10.0}
	var result := ConfigValidationResult.new()

	assert_true(ConfigRepositoryLoaderScript._require_int(source, "value", "test", result, 1), result.to_text())
	assert_false(result.has_errors(), result.to_text())
	assert_eq(source["value"], 10)
	assert_eq(typeof(source["value"]), TYPE_INT)


func test_integer_validator_rejects_invalid_integer_values() -> void:
	var rejected_values := [1.5, NAN, INF, "1", true, null]
	for value in rejected_values:
		var source := {"value": value}
		var result := ConfigValidationResult.new()

		assert_false(ConfigRepositoryLoaderScript._require_int(source, "value", "test", result))
		assert_true(result.has_error_containing("Field 'value' must be an integer."), result.to_text())


func test_malformed_json_fails_with_parse_diagnostic() -> void:
	var manifest_path := _write_config_set("malformed_json")
	_write_file(TEST_ROOT.path_join("malformed_json/economy/producers.json"), "{")

	var result: ConfigValidationResult = ConfigRepositoryLoaderScript.load_from_manifest_path(manifest_path)

	assert_true(result.has_errors(), "Malformed JSON should fail.")
	assert_true(result.has_error_containing("[parse]"), result.to_text())
	assert_true(result.has_error_containing("Malformed JSON"), result.to_text())


func test_missing_required_field_fails_structural_validation() -> void:
	var overrides := _valid_documents()
	overrides["producers"]["producers"][0].erase("baseCost")
	var manifest_path := _write_config_set("missing_required_field", overrides)

	var result: ConfigValidationResult = ConfigRepositoryLoaderScript.load_from_manifest_path(manifest_path)

	assert_true(result.has_errors(), "Missing required producer field should fail.")
	assert_true(result.has_error_containing("[structural]"), result.to_text())
	assert_true(result.has_error_containing("baseCost"), result.to_text())


func test_duplicate_ids_fail_cross_reference_validation() -> void:
	var overrides := _valid_documents()
	overrides["producers"]["producers"].append(overrides["producers"]["producers"][0].duplicate(true))
	var manifest_path := _write_config_set("duplicate_ids", overrides)

	var result: ConfigValidationResult = ConfigRepositoryLoaderScript.load_from_manifest_path(manifest_path)

	assert_true(result.has_errors(), "Duplicate producer IDs should fail.")
	assert_true(result.has_error_containing("[cross-reference]"), result.to_text())
	assert_true(result.has_error_containing("Duplicate id 'test_fabricator'"), result.to_text())


func test_invalid_references_fail_cross_reference_validation() -> void:
	var overrides := _valid_documents()
	overrides["producers"]["producers"][0]["eraId"] = "missing_era"
	var manifest_path := _write_config_set("invalid_reference", overrides)

	var result: ConfigValidationResult = ConfigRepositoryLoaderScript.load_from_manifest_path(manifest_path)

	assert_true(result.has_errors(), "Unknown producer eraId should fail.")
	assert_true(result.has_error_containing("[cross-reference]"), result.to_text())
	assert_true(result.has_error_containing("Unknown eraId 'missing_era'"), result.to_text())


func test_semantic_validation_rejects_invalid_numbers() -> void:
	var overrides := _valid_documents()
	overrides["producers"]["producers"][0]["costGrowth"] = 1.0
	var manifest_path := _write_config_set("semantic_invalid_number", overrides)

	var result: ConfigValidationResult = ConfigRepositoryLoaderScript.load_from_manifest_path(manifest_path)

	assert_true(result.has_errors(), "Invalid growth should fail.")
	assert_true(result.has_error_containing("[semantic]"), result.to_text())
	assert_true(result.has_error_containing("costGrowth must be greater than 1"), result.to_text())


func _write_config_set(name: String, documents: Dictionary = {}, manifest_overrides: Dictionary = {}) -> String:
	if documents.is_empty():
		documents = _valid_documents()

	var root := TEST_ROOT.path_join(name)
	var economy_root := root.path_join("economy")
	DirAccess.make_dir_recursive_absolute(economy_root)

	var manifest := {
		"schemaVersion": 1,
		"gameVersion": "test",
		"saveVersion": 1,
		"contentVersion": name,
		"economyVersion": ECONOMY_VERSION,
		"files": {
			"eras": "economy/eras.json",
			"producers": "economy/producers.json",
			"milestones": "economy/milestones.json"
		}
	}
	for key in manifest_overrides.keys():
		manifest[key] = manifest_overrides[key]

	_write_file(root.path_join("config_manifest.json"), JSON.stringify(manifest, "\t"))
	_write_file(economy_root.path_join("eras.json"), JSON.stringify(documents["eras"], "\t"))
	_write_file(economy_root.path_join("producers.json"), JSON.stringify(documents["producers"], "\t"))
	_write_file(economy_root.path_join("milestones.json"), JSON.stringify(documents["milestones"], "\t"))
	return root.path_join("config_manifest.json")


func _valid_documents() -> Dictionary:
	return {
		"eras": {
			"schemaVersion": 1,
			"economyVersion": ECONOMY_VERSION,
			"eras": [
				{
					"id": "test_workshop",
					"displayName": "Test Workshop",
					"order": 0
				}
			]
		},
		"producers": {
			"schemaVersion": 1,
			"economyVersion": ECONOMY_VERSION,
			"producers": [
				{
					"id": "test_fabricator",
					"displayName": "Test Fabricator",
					"eraId": "test_workshop",
					"baseCost": 5.0,
					"costGrowth": 1.1,
					"baseProductionPerLevel": 0.5,
					"sortOrder": 0
				}
			]
		},
		"milestones": {
			"schemaVersion": 1,
			"economyVersion": ECONOMY_VERSION,
			"milestones": [
				{
					"level": 10,
					"productionMultiplier": 2.0
				}
			]
		}
	}


func _write_file(path: String, text: String) -> void:
	var file := FileAccess.open(path, FileAccess.WRITE)
	assert_not_null(file, "Fixture file should open for writing: %s" % path)
	file.store_string(text)
