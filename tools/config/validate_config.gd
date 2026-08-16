extends SceneTree

const ConfigRepositoryLoaderScript := preload("res://scripts/config/config_repository_loader.gd")

const DEFAULT_MANIFEST_PATH := "res://data/config_manifest.json"


func _init() -> void:
	var max_iter := 20
	var iter := 0
	while Engine.get_main_loop() == null and iter < max_iter:
		await create_timer(0.01).timeout
		iter += 1

	var manifest_path := _get_manifest_path()
	var result: ConfigValidationResult = ConfigRepositoryLoaderScript.load_from_manifest_path(manifest_path)
	if result.has_errors():
		printerr("Project Automata configuration validation failed.")
		for line in result.to_lines():
			printerr(line)
		quit(1)
		return

	var repository: GameConfigRepository = result.repository
	print("Project Automata configuration validation passed.")
	print("schemaVersion=%d gameVersion=%s saveVersion=%d contentVersion=%s economyVersion=%s" % [
		repository.schema_version,
		repository.game_version,
		repository.save_version,
		repository.content_version,
		repository.economy_version
	])
	print("eras=%d producers=%d milestones=%d" % [
		repository.eras.size(),
		repository.producers.size(),
		repository.milestones.size()
	])
	quit(0)


func _get_manifest_path() -> String:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--config-manifest="):
			return arg.trim_prefix("--config-manifest=")
	return DEFAULT_MANIFEST_PATH
