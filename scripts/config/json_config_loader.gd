class_name JsonConfigLoader
extends RefCounted


static func load_json_file(source_path: String, result) -> Variant:
	if not FileAccess.file_exists(source_path):
		result.add_error("parse", source_path, "JSON file does not exist.")
		return null

	var file := FileAccess.open(source_path, FileAccess.READ)
	if file == null:
		result.add_error("parse", source_path, "JSON file could not be opened: %s." % error_string(FileAccess.get_open_error()))
		return null

	var text := file.get_as_text()
	var json := JSON.new()
	var parse_error := json.parse(text)
	if parse_error != OK:
		result.add_error(
			"parse",
			source_path,
			"Malformed JSON at line %d: %s." % [json.get_error_line(), json.get_error_message()]
		)
		return null

	return json.data
