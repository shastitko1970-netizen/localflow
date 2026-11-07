//! Prints MCP client config for LocalFlow's local HTTP MCP endpoint.
use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "localflow-mcp", about = "LocalFlow MCP helper")]
struct Args {
    #[arg(long, default_value_t = 17832)]
    port: u16,
}

fn main() {
    let args = Args::parse();
    println!(
        r#"{{
  "mcpServers": {{
    "localflow": {{
      "url": "http://127.0.0.1:{}/mcp"
    }}
  }}
}}
"#,
        args.port
    );
    eprintln!("Start the LocalFlow app so the MCP HTTP server is listening.");
}
