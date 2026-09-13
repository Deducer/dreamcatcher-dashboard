(function(root) {
    const DAY = 86400000;
    function presetDates(preset, now = Date.now()) {
        const today = Date.parse(new Date(now).toISOString().slice(0,10));
        const date = new Date(today), year = date.getUTCFullYear(), month = date.getUTCMonth();
        const monday = today - ((date.getUTCDay()+6)%7)*DAY;
        let start, end = today;
        const rolling = {'yesterday':1,'7d':7,'30d':30,'90d':90};
        if (rolling[preset]) start = today-rolling[preset]*DAY;
        else if (preset === 'this_week') start = monday;
        else if (preset === 'last_week') { start = monday-7*DAY; end = monday; }
        else if (preset === 'this_month') start = Date.UTC(year,month,1);
        else if (preset === 'last_month') { start=Date.UTC(year,month-1,1); end=Date.UTC(year,month,1); }
        else if (preset === 'ytd') start=Date.UTC(year,0,1);
        else if (preset === 'last_year') { start=Date.UTC(year-1,0,1);end=Date.UTC(year,0,1); }
        else return null;
        if (start >= end) return null;
        return {start:new Date(start).toISOString().slice(0,10),end:new Date(end-DAY).toISOString().slice(0,10)};
    }
    if(typeof module !== 'undefined') module.exports = {presetDates};
    else root.presetDates = presetDates;
})(globalThis);
