mod db;
mod model;
mod providers;

use serde::Serialize;
use std::env;
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();

    let mut quiet = false;
    let mut json = false;
    let mut db_path: Option<String> = None;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "-h" | "--help" => {
                print_help();
                return;
            }
            "-v" | "--version" => {
                println!("0.3.0");
                return;
            }
            "-q" | "--quiet" => quiet = true,
            "--json" => json = true,
            "--db" => {
                i += 1;
                db_path = args.get(i).cloned();
                match &db_path {
                    None => {
                        eprintln!("Error: --db requires a path");
                        std::process::exit(1);
                    }
                    Some(p) if p.starts_with('-') => {
                        eprintln!("Error: --db requires a path, got '{p}'");
                        std::process::exit(1);
                    }
                    _ => {}
                }
            }
            other => {
                eprintln!("Unknown option: {other}\nRun 'skilled-index --help' for usage.");
                std::process::exit(1);
            }
        }
        i += 1;
    }

    let home = env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .unwrap_or_else(|_| "/tmp".into());

    let db_file = match db_path {
        Some(p) => PathBuf::from(p),
        None => PathBuf::from(&home).join(".skilled").join("index.db"),
    };

    let progress = !quiet && !json;
    let results = providers::all_providers(&home, progress);

    match db::write_index(&db_file, &results) {
        Ok(stats) => {
            if json {
                let output = JsonOutput {
                    calls: stats.total_calls,
                    providers: results
                        .iter()
                        .map(|r| JsonProvider {
                            name: &r.name,
                            available: r.available,
                            calls: r.calls.len(),
                        })
                        .collect(),
                    elapsed_ms: stats.elapsed_ms,
                    db: db_file.display().to_string(),
                };
                println!("{}", serde_json::to_string_pretty(&output).unwrap());
            } else if !quiet {
                eprintln!(
                    "wrote {} calls to {} in {}ms",
                    stats.total_calls, db_file.display(), stats.elapsed_ms
                );
            }
        }
        Err(e) => {
            eprintln!("Error: {e}");
            std::process::exit(1);
        }
    }
}

#[derive(Serialize)]
struct JsonOutput<'a> {
    calls: usize,
    providers: Vec<JsonProvider<'a>>,
    elapsed_ms: u128,
    db: String,
}

#[derive(Serialize)]
struct JsonProvider<'a> {
    name: &'a str,
    available: bool,
    calls: usize,
}

fn print_help() {
    println!(
        "skilled-index — build skill usage index

Usage: skilled-index [options]

Options:
  -h, --help       Show this help
  -v, --version    Show version
  -q, --quiet      Suppress output
  --json           Output stats as JSON (to stdout)
  --db <path>      Custom DB path (default: ~/.skilled/index.db)"
    );
}
