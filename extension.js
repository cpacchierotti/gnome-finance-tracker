import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import Clutter from 'gi://Clutter';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const CONFIG_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'gnome-finance-tracker']);
const CONFIG_FILE = GLib.build_filenamev([CONFIG_DIR, 'portfolio.json']);

const DEFAULT_CONFIG = {
    refresh_interval_seconds: 300,
    currency_symbol: "€",
    show_total_value: true,
    show_change_amount: true,
    show_change_percent: true,
    show_day_change_amount: true,
    show_day_change_percent: true,
    assets: [
        {
            symbol: "VWCE.DE",
            name: "Vanguard FTSE All-World",
            isin: "IE00BK5BQT80",
            amount: 100,
            pru: 100.00
        }
    ]
};

export default class FinanceTrackerExtension extends Extension {
    enable() {
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);
        
        // Add a simple label initially
        this._label = new St.Label({
            text: 'Loading...',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._indicator.add_child(this._label);
        
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._cancellable = new Gio.Cancellable();
        this._httpSession = new Soup.Session();
        this._timeoutId = null;
        this._configMonitor = null;
        this._configMonitorSignalId = null;
        this._config = null;
        this._assetsData = {}; // Cache to store fetched data
        this._isRefreshing = false;

        this._ensureConfigDir();
        this._loadConfig();
        this._setupConfigMonitor();
    }

    disable() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }

        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        if (this._configMonitor) {
            if (this._configMonitorSignalId) {
                this._configMonitor.disconnect(this._configMonitorSignalId);
                this._configMonitorSignalId = null;
            }
            this._configMonitor.cancel();
            this._configMonitor = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        if (this._httpSession) {
            this._httpSession.abort();
            this._httpSession = null;
        }

        this._label = null;
        this._config = null;
        this._assetsData = {};
        this._isRefreshing = false;
    }

    _ensureConfigDir() {
        try {
            let dir = Gio.File.new_for_path(CONFIG_DIR);
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }

            let file = Gio.File.new_for_path(CONFIG_FILE);
            if (!file.query_exists(null)) {
                let contentString = JSON.stringify(DEFAULT_CONFIG, null, 2);
                GLib.file_set_contents(CONFIG_FILE, contentString);
            }
        } catch (e) {
            console.error(`[Finance Tracker] Failed in _ensureConfigDir: ${e.message}`);
        }
    }

    _loadConfig() {
        let file = Gio.File.new_for_path(CONFIG_FILE);
        try {
            let [success, contents] = file.load_contents(null);
            if (success) {
                let decoder = new TextDecoder('utf-8');
                let jsonString = decoder.decode(contents);
                let parsed = JSON.parse(jsonString);
                if (parsed && typeof parsed === 'object') {
                    this._config = parsed;
                }
            }
        } catch (e) {
            console.error(`[Finance Tracker] Failed to load config: ${e.message}`);
            if (!this._config) {
                this._config = DEFAULT_CONFIG;
            }
        }

        this._refreshData().catch(e => {
            console.error(`[Finance Tracker] Uncaught error in _refreshData: ${e.message}`);
        });
        this._scheduleUpdate();
    }

    _setupConfigMonitor() {
        let file = Gio.File.new_for_path(CONFIG_FILE);
        this._configMonitor = file.monitor(Gio.FileMonitorFlags.NONE, null);
        this._configMonitorSignalId = this._configMonitor.connect('changed', (monitor, file, otherFile, eventType) => {
            if (eventType === Gio.FileMonitorEvent.CHANGED || eventType === Gio.FileMonitorEvent.CREATED) {
                this._loadConfig();
            }
        });
    }

    _scheduleUpdate() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }

        let rawInterval = this._config ? this._config.refresh_interval_seconds : 300;
        let interval = (typeof rawInterval === 'number' && Number.isFinite(rawInterval)) 
            ? Math.max(10, Math.floor(rawInterval)) 
            : 300;
        
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._refreshData().catch(e => {
                console.error(`[Finance Tracker] Uncaught error in scheduled _refreshData: ${e.message}`);
            });
            return GLib.SOURCE_CONTINUE;
        });
    }

    async _refreshData() {
        if (!this._indicator || this._isRefreshing) return;

        if (!this._config || !Array.isArray(this._config.assets) || this._config.assets.length === 0) {
            if (this._label) {
                this._label.style = null;
                this._label.set_text('No assets');
            }
            return;
        }

        this._isRefreshing = true;
        if (this._label) {
            this._label.style = null;
            this._label.set_text('Fetching...');
        }

        let totalValue = 0;
        let totalInvested = 0;
        let totalDayChange = 0;
        let fetchSuccess = true;

        try {
            for (let asset of this._config.assets) {
                if (!this._indicator) break;
                if (!asset || typeof asset.symbol !== 'string' || !asset.symbol.trim()) continue;

                const symbol = asset.symbol.trim();
                const amount = Number(asset.amount) || 0;
                const pru = Number(asset.pru) || 0;

                try {
                    const data = await this._fetchAssetData(symbol);
                    if (data && typeof data.price === 'number') {
                        this._assetsData[symbol] = data;
                        totalValue += (data.price * amount);
                        totalInvested += (pru * amount);

                        const prevClose = (typeof data.previousClose === 'number' && Number.isFinite(data.previousClose))
                            ? data.previousClose
                            : data.price;
                        totalDayChange += ((data.price - prevClose) * amount);
                    } else {
                        fetchSuccess = false;
                    }
                } catch (e) {
                    console.error(`[Finance Tracker] Error fetching ${symbol}: ${e.message}\n${e.stack}`);
                    fetchSuccess = false;
                }
            }

            if (this._indicator) {
                this._updateUI(totalValue, totalInvested, totalDayChange, fetchSuccess);
            }
        } catch (err) {
            console.error(`[Finance Tracker] Critical error in _refreshData loop: ${err.message}\n${err.stack}`);
            if (this._label) {
                this._label.style = null;
                this._label.set_text('Error');
            }
        } finally {
            this._isRefreshing = false;
        }
    }

    _fetchAssetData(symbol) {
        return new Promise((resolve, reject) => {
            if (!this._httpSession || !this._cancellable || this._cancellable.is_cancelled()) {
                reject(new Error('HTTP session is closed or cancelled'));
                return;
            }

            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
            const message = Soup.Message.new('GET', url);
            message.request_headers.append('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');

            this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, this._cancellable, (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    if (message.status_code === 200 && bytes) {
                        const decoder = new TextDecoder('utf-8');
                        const response = JSON.parse(decoder.decode(bytes.get_data()));
                        
                        if (response && response.chart && Array.isArray(response.chart.result) && response.chart.result.length > 0) {
                            const meta = response.chart.result[0].meta;
                            if (meta && typeof meta.regularMarketPrice === 'number') {
                                const prevClose = meta.previousClose || meta.chartPreviousClose || meta.regularMarketPrice;
                                const percentChange = prevClose !== 0 
                                    ? ((meta.regularMarketPrice - prevClose) / prevClose) * 100 
                                    : 0;
                                resolve({
                                    price: meta.regularMarketPrice,
                                    previousClose: prevClose,
                                    percentChange: percentChange
                                });
                                return;
                            }
                        }
                        reject(new Error(`Invalid response structure for ${symbol}`));
                    } else {
                        reject(new Error(`HTTP Error: ${message.status_code}`));
                    }
                } catch (e) {
                    if (e && e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        return;
                    }
                    reject(e);
                }
            });
        });
    }

    _formatNumber(value) {
        if (typeof value !== 'number' || isNaN(value)) return '0.00';
        return value.toFixed(2);
    }

    _escapeMarkup(text) {
        if (!text) return '';
        return GLib.markup_escape_text(String(text), -1);
    }

    _updateUI(totalValue, totalInvested, totalDayChange, fetchSuccess) {
        if (!this._indicator) return;

        try {
            this._indicator.menu.removeAll();

            if (!fetchSuccess && Object.keys(this._assetsData).length === 0) {
                if (this._label) {
                    this._label.style = null;
                    this._label.set_text('Error fetching data');
                }
                return;
            }

            const currency = (this._config && typeof this._config.currency_symbol === 'string') 
                ? this._config.currency_symbol 
                : '€';

            const showTotal = (this._config && typeof this._config.show_total_value === 'boolean') 
                ? this._config.show_total_value 
                : true;

            const showChangeAmount = (this._config && typeof this._config.show_change_amount === 'boolean') 
                ? this._config.show_change_amount 
                : true;

            const showChangePercent = (this._config && typeof this._config.show_change_percent === 'boolean') 
                ? this._config.show_change_percent 
                : true;

            const showDayChangeAmount = (this._config && typeof (this._config.show_day_change_amount ?? this._config.show_daily_change_amount) === 'boolean')
                ? (this._config.show_day_change_amount ?? this._config.show_daily_change_amount)
                : true;

            const showDayChangePercent = (this._config && typeof (this._config.show_day_change_percent ?? this._config.show_daily_change_percent) === 'boolean')
                ? (this._config.show_day_change_percent ?? this._config.show_daily_change_percent)
                : true;

            const totalProfit = totalValue - totalInvested;
            const totalProfitPercent = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

            const profitAmountSign = totalProfit >= 0 ? '+' : '-';
            const profitPercentSign = totalProfit >= 0 ? '+' : '';
            const profitAmountStr = `${profitAmountSign}${currency}${this._formatNumber(Math.abs(totalProfit))}`;
            const profitPercentStr = `${profitPercentSign}${this._formatNumber(totalProfitPercent)}%`;

            const totalPreviousValue = totalValue - totalDayChange;
            const totalDayChangePercent = totalPreviousValue > 0 ? (totalDayChange / totalPreviousValue) * 100 : 0;

            const dayAmountSign = totalDayChange >= 0 ? '+' : '-';
            const dayPercentSign = totalDayChange >= 0 ? '+' : '';
            const dayAmountStr = `${dayAmountSign}${currency}${this._formatNumber(Math.abs(totalDayChange))}`;
            const dayPercentStr = `${dayPercentSign}${this._formatNumber(totalDayChangePercent)}%`;

            const profitColor = totalProfit >= 0 ? '#4caf50' : '#f44336';
            const dayColor = totalDayChange >= 0 ? '#4caf50' : '#f44336';

            // Build status bar panel label dynamically based on visibility settings
            let labelParts = [];
            if (showTotal) {
                labelParts.push(`${currency}${this._formatNumber(totalValue)}`);
            }

            let overallParts = [];
            if (showChangeAmount) {
                overallParts.push(profitAmountStr);
            }
            if (showChangePercent) {
                overallParts.push(profitPercentStr);
            }

            let dayParts = [];
            if (showDayChangeAmount) {
                dayParts.push(dayAmountStr);
            }
            if (showDayChangePercent) {
                dayParts.push(dayPercentStr);
            }

            let changeGroups = [];
            if (overallParts.length > 0) {
                const overallMarkup = `<span foreground="${profitColor}">${overallParts.join(', ')}</span>`;
                changeGroups.push(overallMarkup);
            }
            if (dayParts.length > 0) {
                let dayStr = dayParts.join(', ');
                if (overallParts.length > 0) {
                    dayStr = `1d: ${dayStr}`;
                }
                const dayMarkup = `<span foreground="${dayColor}">${dayStr}</span>`;
                changeGroups.push(dayMarkup);
            }

            if (changeGroups.length > 0) {
                const changesJoined = changeGroups.join(' | ');
                if (showTotal) {
                    labelParts.push(`(${changesJoined})`);
                } else {
                    labelParts.push(changesJoined);
                }
            }

            let finalLabel = labelParts.join(' ');
            if (!finalLabel) {
                finalLabel = `${currency}${this._formatNumber(totalValue)}`;
            }

            // Apply direct CSS color style to St.Label when a single change color applies
            if (!showTotal && changeGroups.length === 1) {
                if (overallParts.length > 0) {
                    this._label.style = `color: ${profitColor};`;
                } else if (dayParts.length > 0) {
                    this._label.style = `color: ${dayColor};`;
                }
            } else if (!showTotal && changeGroups.length > 1 && profitColor === dayColor) {
                this._label.style = `color: ${profitColor};`;
            } else {
                this._label.style = null;
            }

            if (this._label) {
                this._label.set_text(finalLabel);
                if (this._label.clutter_text) {
                    this._label.clutter_text.set_use_markup(true);
                    this._label.clutter_text.set_markup(finalLabel);
                }
            }

            // Add summary menu items
            let summaryItem = new PopupMenu.PopupMenuItem(`Portfolio Value: ${currency}${this._formatNumber(totalValue)}`, { reactive: false });
            
            let profitItem = new PopupMenu.PopupMenuItem('', { reactive: false });
            profitItem.label.clutter_text.set_use_markup(true);
            profitItem.label.clutter_text.set_markup(
                `Net Profit: <span foreground="${profitColor}">${profitAmountStr} (${profitPercentStr})</span>`
            );

            let dayItem = new PopupMenu.PopupMenuItem('', { reactive: false });
            dayItem.label.clutter_text.set_use_markup(true);
            dayItem.label.clutter_text.set_markup(
                `Day's Change: <span foreground="${dayColor}">${dayAmountStr} (${dayPercentStr})</span>`
            );

            this._indicator.menu.addMenuItem(summaryItem);
            this._indicator.menu.addMenuItem(profitItem);
            this._indicator.menu.addMenuItem(dayItem);
            this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            if (Array.isArray(this._config.assets)) {
                for (let asset of this._config.assets) {
                    if (!asset || !asset.symbol || typeof asset.symbol !== 'string' || !asset.symbol.trim()) continue;

                    const symbol = asset.symbol.trim();
                    let data = this._assetsData[symbol];
                    if (!data) continue;

                    const amount = Number(asset.amount) || 0;
                    const pru = Number(asset.pru) || 0;

                    const assetValue = data.price * amount;
                    const assetInvested = pru * amount;
                    const assetProfit = assetValue - assetInvested;

                    const prevClose = (typeof data.previousClose === 'number' && Number.isFinite(data.previousClose))
                        ? data.previousClose
                        : data.price;
                    const assetDayChange = (data.price - prevClose) * amount;
                    const assetDaySign = assetDayChange >= 0 ? '+' : '-';
                    const assetDayAmountStr = `${assetDaySign}${currency}${this._formatNumber(Math.abs(assetDayChange))}`;
                    const dailyChangeSign = data.percentChange >= 0 ? '+' : '';
                    const assetDayPercentStr = `${dailyChangeSign}${this._formatNumber(data.percentChange)}%`;

                    const assetProfitAmountStr = `${assetProfit >= 0 ? '+' : '-'}${currency}${this._formatNumber(Math.abs(assetProfit))}`;

                    const assetProfitPercent = assetInvested > 0 ? (assetProfit / assetInvested) * 100 : 0;
                    const assetProfitPercentSign = assetProfit >= 0 ? '+' : '';
                    const assetProfitPercentStr = `${assetProfitPercentSign}${this._formatNumber(assetProfitPercent)}%`;

                    let menuItem = new PopupMenu.PopupMenuItem('', { reactive: false });
                    menuItem.label.clutter_text.set_use_markup(true);
                    
                    let dailyColor = data.percentChange >= 0 ? '#4caf50' : '#f44336';
                    let assetProfitColor = assetProfit >= 0 ? '#4caf50' : '#f44336';

                    const cleanSymbol = this._escapeMarkup(symbol);
                    const cleanIsin = asset.isin ? this._escapeMarkup(asset.isin) : '';
                    const rawName = (asset.name ?? asset.friendly_name) || '';
                    const hasName = typeof rawName === 'string' && rawName.trim().length > 0;
                    const cleanName = hasName ? this._escapeMarkup(rawName.trim()) : '';

                    let headerText = '';
                    if (hasName) {
                        let subInfo = [];
                        if (cleanSymbol) subInfo.push(cleanSymbol);
                        if (cleanIsin) subInfo.push(cleanIsin);
                        let subStr = subInfo.length > 0 ? `<span size="small" foreground="gray">(${subInfo.join(' - ')})</span>` : '';
                        headerText = `<b>${cleanName}</b> ${subStr}`;
                    } else {
                        headerText = `<b>${cleanSymbol}</b> ${cleanIsin ? `<span size="small" foreground="gray">(${cleanIsin})</span>` : ''}`;
                    }

                    let markupText = `${headerText}\n` +
                                     `Price: <b>${currency}${this._formatNumber(data.price)}</b> | Value: <b>${currency}${this._formatNumber(assetValue)}</b>\n` +
                                     `Day's Change: <span foreground="${dailyColor}">${assetDayAmountStr} (${assetDayPercentStr})</span>\n` +
                                     `Net Profit: <span foreground="${assetProfitColor}">${assetProfitAmountStr} (${assetProfitPercentStr})</span>`;
                    
                    menuItem.label.clutter_text.set_markup(markupText);
                    this._indicator.menu.addMenuItem(menuItem);
                }
            }
        } catch (e) {
            console.error(`[Finance Tracker] Error in _updateUI: ${e.message}\n${e.stack}`);
        }
    }
}

