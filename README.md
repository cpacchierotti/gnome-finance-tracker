# GNOME Finance Tracker

A lightweight, modern GNOME Shell extension to monitor your stock, ETF, and investment portfolio directly from the top panel.

## Features

- 📈 **Real-Time Top Panel Summary**: View total portfolio value, overall net profit/loss, and daily performance directly in your top bar.
- 📊 **Detailed Portfolio Breakdown**: Click the panel menu to see individual asset prices, total holding values, daily changes, and net profit per asset.
- ⚙️ **Automatic Config Monitoring**: Hot-reloads configuration automatically when `~/.config/gnome-finance-tracker/portfolio.json` is modified.
- 🎨 **Customizable Display**: Customize currency symbols, refresh intervals, and toggle individual display metrics (total value, daily change, percentage change).
- 🚀 **Modern GNOME Shell Compatibility**: Built for GNOME Shell 45, 46, 47, and 48 using ES Modules.

**Screenshot**

<img width="807" height="535" alt="image" src="https://github.com/user-attachments/assets/9eaa60ab-d64c-42f5-9e2a-1a251044dc03" />


## Installation

### From GNOME Extensions (EGO)
Install directly from [extensions.gnome.org](https://extensions.gnome.org/extension/finance-tracker@cpacchierotti.github.io).

### Manual Installation
1. Clone this repository into your GNOME extensions directory:
   ```bash
   mkdir -p ~/.local/share/gnome-shell/extensions
   git clone https://github.com/cpacchierotti/gnome-finance-tracker.git ~/.local/share/gnome-shell/extensions/finance-tracker@cpacchierotti.github.io
   ```
2. Enable the extension:
   ```bash
   gnome-extensions enable finance-tracker@cpacchierotti.github.io
   ```
3. Restart GNOME Shell (on X11: press `Alt+F2`, type `r`, and hit `Enter`; on Wayland: log out and log back in).

## Configuration

The extension stores its configuration in `~/.config/gnome-finance-tracker/portfolio.json`. 

### Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `refresh_interval_seconds` | Number | `300` | Refresh frequency in seconds (minimum 10s). |
| `currency_symbol` | String | `"€"` | Currency symbol to display (e.g. `$`, `€`, `£`, `¥`). |
| `show_total_value` | Boolean | `true` | Show total portfolio value in top panel. |
| `show_change_amount` | Boolean | `true` | Show total profit/loss amount. |
| `show_change_percent` | Boolean | `true` | Show total profit/loss percentage. |
| `show_day_change_amount` | Boolean | `true` | Show 1-day profit/loss amount. |
| `show_day_change_percent` | Boolean | `true` | Show 1-day profit/loss percentage. |
| `assets` | Array | Sample | List of portfolio holdings. |

### Sample `portfolio.json`

```json
{
  "refresh_interval_seconds": 300,
  "currency_symbol": "€",
  "show_total_value": true,
  "show_change_amount": true,
  "show_change_percent": true,
  "show_day_change_amount": true,
  "show_day_change_percent": true,
  "assets": [
    {
      "symbol": "VWCE.DE",
      "name": "Vanguard FTSE All-World",
      "isin": "IE00BK5BQT80",
      "amount": 100,
      "pru": 100.00
    },
    {
      "symbol": "AAPL",
      "name": "Apple Inc.",
      "isin": "US0378331005",
      "amount": 10,
      "pru": 180.50
    }
  ]
}
```

### Asset Object Fields

- `symbol`: Ticker symbol used on Yahoo Finance (e.g., `VWCE.DE`, `AAPL`, `MSFT`).
- `name`: (Optional) Custom descriptive name for the asset.
- `isin`: (Optional) ISIN code for reference.
- `amount`: Number of units/shares owned.
- `pru`: Average purchase price per unit (*Prix Revient Unitaire*).

## License

This project is licensed under the GPL-2.0 License - see the [LICENSE](LICENSE) file for details.
