let interceptedGameData = null;

function setupRequestInterception() {
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    
    if (args[0]?.includes?.('/api/GetMyGames') || 
        (typeof args[0] === 'string' && args[0].includes('GetMyGames'))) {
      
      const responseClone = response.clone();
      try {
        const data = await responseClone.json();
        interceptedGameData = data;
        
        if (Array.isArray(data)) {
          for (const game of data) {
            if (game.name && game.AverageFunScore !== undefined) {
              const avgSSS = [
                game.AverageFunScore || 0,
                game.AverageArtScore || 0,
                game.AverageCreativityScore || 0,
                game.AverageAudioScore || 0,
                game.AverageMoodScore || 0
              ].reduce((a, b) => a + b, 0);
              
              let totalHours = 0;
              const ships = [];
              
              if (game.posts && Array.isArray(game.posts)) {
                const sortedPosts = [...game.posts].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
                
                let cumulativeHours = 0;
                for (const post of sortedPosts) {
                  cumulativeHours += post.hoursSpent || 0;
                  
                  if (post.PlayLink && post.PlayLink.trim()) {
                    ships.push({
                      postId: post.postId,
                      hoursAtShip: cumulativeHours,
                      playLink: post.PlayLink,
                      createdAt: post.createdAt
                    });
                  }
                }
                totalHours = cumulativeHours;
                
                const totalMinutes = totalHours * 60;
                let playtestCount = 0;
                const shippedBlocks = new Set();
                
                for (const ship of ships) {
                  const shipMinutes = ship.hoursAtShip * 60;
                  const block = Math.floor(shipMinutes / 600);
                  
                  if (!shippedBlocks.has(block)) {
                    ship.playtestsEarned = 5;
                    playtestCount += 5;
                    shippedBlocks.add(block);
                  } else {
                    ship.playtestsEarned = 0;
                  }
                }
                
                const moments = game.posts.map(post => ({
                  totalMinutes: (post.hoursSpent || 0) * 60,
                  timestamp: post.createdAt,
                  content: post.content || '',
                  isDemo: !!(post.PlayLink && post.PlayLink.trim())
                }));
                
                const schedule = {
                  ships: ships.map(ship => ({
                    moment: moments.find(m => m.isDemo),
                    cumulativeMinutes: ship.hoursAtShip * 60,
                    block: Math.floor((ship.hoursAtShip * 60) / 600),
                    playtestsEarned: ship.playtestsEarned
                  })),
                  playtestCount,
                  totalMinutes
                };
                
                saveShippingData(game.name, `https://shiba.hackclub.com/games/${game.id}`, moments, schedule, game.posts.length);
              }
              
              const existing = JSON.parse(localStorage.getItem('shibaGameStats') || '{}')[game.name];
              if (!existing || 
                  existing.averageSSSPerPlaytest !== avgSSS || 
                  existing.numPlaytests !== (game.numberComplete || 0)) {
                saveGameData(game.name, avgSSS, game.numberComplete || 0);
              }
            }
          }
        }
      } catch (error) {
        console.error(`Shiba Utils: ${error}`)
      }
    }
    
    return response;
  };
  
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    this._url = url;
    return originalXHROpen.call(this, method, url, ...args);
  };
  
  XMLHttpRequest.prototype.send = function(...args) {
    if (this._url?.includes?.('GetMyGames')) {
      this.addEventListener('load', function() {
        try {
          const data = JSON.parse(this.responseText);
          interceptedGameData = data;
        } catch (error) {
        }
      });
    }
    return originalXHRSend.call(this, ...args);
  };
}

async function getGameData() {
  if (interceptedGameData) {
    return interceptedGameData;
  }
  
  const token = localStorage.getItem('token') || localStorage.getItem('authToken') || localStorage.getItem('userToken');
  if (!token) return null;

  try {
    const response = await fetch('https://shiba.hackclub.com/api/GetMyGames', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    return response.ok ? await response.json() : null;
  } catch (error) {
    return null;
  }
}

function getCurrentGameName() {
  const gameNameInput = document.querySelector('input[placeholder="Game Name"]');
  return gameNameInput?.value || null;
}

function getCurrentUserName() {
  const cached = localStorage.getItem('shibautils_username');
  if (cached) return cached;

  const titleMatch = document.title.match(/(.+)'s/);
  if (titleMatch) {
    const username = titleMatch[1];
    localStorage.setItem('shibautils_username', username);
    return username;
  }

  const urlMatch = window.location.href.match(/\/users\/([^\/]+)/);
  if (urlMatch) {
    const username = urlMatch[1];
    localStorage.setItem('shibautils_username', username);
    return username;
  }

  return null;
}

function saveGameData(gameName, averageSSSPerPlaytest, numPlaytests) {
  const savedGames = JSON.parse(localStorage.getItem('shibaGameStats') || '{}');
  savedGames[gameName] = {
    averageSSSPerPlaytest,
    numPlaytests,
    lastUpdated: Date.now()
  };
  localStorage.setItem('shibaGameStats', JSON.stringify(savedGames));
}

function saveShippingData(gameName, gameUrl, moments, schedule, devlogCount = null) {
  const savedData = JSON.parse(localStorage.getItem('shibaShippingData') || '{}');
  savedData[gameName] = {
    gameUrl,
    moments,
    schedule,
    devlogCount,
    lastUpdated: Date.now()
  };
  localStorage.setItem('shibaShippingData', JSON.stringify(savedData));
}

function getShippingData(gameName) {
  const savedData = JSON.parse(localStorage.getItem('shibaShippingData') || '{}');
  return savedData[gameName] || null;
}

function needsUpdate(gameName, currentDevlogCount, currentAPIPlaytests) {
  const cached = getShippingData(gameName);
  if (!cached) return true;
  
  if (cached.devlogCount !== currentDevlogCount) {
    return true;
  }
  
  const gameStats = JSON.parse(localStorage.getItem('shibaGameStats') || '{}')[gameName];
  if (gameStats && gameStats.numPlaytests !== currentAPIPlaytests) {
    return true;
  }
  
  const dayOld = Date.now() - (24 * 60 * 60 * 1000);
  if (cached.lastUpdated < dayOld) {
    return true;
  }
  
  return false;
}

function findMomentCards(container = document) {
  const selectors = [
    '.moment-card',
    '[class*="moment-card"]',
    'div[style*="border"][style*="border-radius"]',
    'div:has(div[style*="white-space: pre-wrap"])'
  ];
  
  const cards = [];
  for (const selector of selectors) {
    try {
      const found = container.querySelectorAll(selector);
      found.forEach(card => {
        if (!cards.includes(card)) cards.push(card);
      });
      if (cards.length > 0) break;
    } catch (e) {
    }
  }
  
  return cards;
}

function parseMoments(cards) {
  const moments = [];
  
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    
    let timeLoggedElement = null;
    const allElements = card.querySelectorAll('*');
    for (const element of allElements) {
      if (element.textContent.includes('logged')) {
        timeLoggedElement = element;
        break;
      }
    }
    
    if (!timeLoggedElement) continue;
    
    const timeMatch = timeLoggedElement.textContent.match(/(\d+)hr?\s*(\d+)?min?/);
    if (!timeMatch) continue;
    
    const hours = parseInt(timeMatch[1]) || 0;
    const minutes = parseInt(timeMatch[2]) || 0;
    const totalMinutes = hours * 60 + minutes;
    
    let timestamp = 'Unknown';
    for (const element of allElements) {
      const text = element.textContent.trim();
      if (/\d{1,2}:\d{2}\s*(AM|PM)|^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(text)) {
        timestamp = text;
        break;
      }
    }
    
    const contentElement = card.querySelector('div[style*="white-space: pre-wrap"]');
    const content = contentElement?.textContent || '';
    
    const isDemo = !!(card.querySelector('button') || card.textContent.includes('Tap to start'));
    
    moments.push({
      totalMinutes,
      timestamp,
      content,
      isDemo
    });
  }
  
  moments.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return moments;
}

function calculateShippingSchedule(moments) {
  let cumulativeMinutes = 0;
  const ships = [];
  let shippedBlocks = new Set();
  
  for (const moment of moments) {
    cumulativeMinutes += moment.totalMinutes;
    
    if (moment.isDemo) {
      const currentBlock = Math.floor(cumulativeMinutes / 600);
      
      if (!shippedBlocks.has(currentBlock)) {
        ships.push({
          moment,
          cumulativeMinutes,
          block: currentBlock,
          blockRange: `${currentBlock * 10}h-${(currentBlock + 1) * 10}h`,
          playtestsEarned: 5
        });
        shippedBlocks.add(currentBlock);
      }
    }
  }
  
  const playtestCount = ships.length * 5;
  return { ships, playtestCount, totalMinutes: cumulativeMinutes };
}

async function fetchGameMomentsBackground(gameUrl) {
  try {
    const response = await fetch(gameUrl);
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    const cards = findMomentCards(doc);
    const moments = parseMoments(cards);
    
    return moments;
  } catch (error) {
    return [];
  }
}

async function scanCurrentGamePage() {
  const gameName = getCurrentGameName();
  if (!gameName) return;
  
  const cards = findMomentCards();
  const moments = parseMoments(cards);
  
  if (moments.length > 0) {
    const schedule = calculateShippingSchedule(moments);
    const gameUrl = window.location.href;
    saveShippingData(gameName, gameUrl, moments, schedule, cards.length);
  }
}

function calculateShopEstimates() {
  const shippingData = JSON.parse(localStorage.getItem('shibaShippingData') || '{}');
  const gameStats = JSON.parse(localStorage.getItem('shibaGameStats') || '{}');
  
  let totalCurrentSSS = 0;
  let totalPlaytests = 0;
  let avgSSSPerPlaytest = 0;
  
  for (const [gameName, data] of Object.entries(shippingData)) {
    if (data.schedule && gameStats[gameName]) {
      const playtests = data.schedule.playtestCount;
      const sssPerPlaytest = gameStats[gameName].averageSSSPerPlaytest;
      totalCurrentSSS += playtests * sssPerPlaytest;
      totalPlaytests += playtests;
    }
  }
  
  if (totalPlaytests > 0) {
    avgSSSPerPlaytest = totalCurrentSSS / totalPlaytests;
  } else {
    const games = Object.values(gameStats);
    if (games.length > 0) {
      avgSSSPerPlaytest = games.reduce((sum, game) => sum + game.averageSSSPerPlaytest, 0) / games.length;
    } else {
      avgSSSPerPlaytest = 12.5;
    }
  }
  
  return { totalCurrentSSS, avgSSSPerPlaytest };
}

function processShopItems() {
  const shopItems = document.querySelectorAll('div[style*="display: flex; flex-direction: column; align-items: flex-start; padding: 16px"]');
  const { totalCurrentSSS, avgSSSPerPlaytest } = calculateShopEstimates();
  
  shopItems.forEach((item, index) => {
    if (item.querySelector('.shiba-estimate-display')) return;
    
    const priceElement = item.querySelector('p[style*="color: rgb(45, 90, 39)"]');
    const buyButton = item.querySelector('button');
    const sssImage = item.querySelector('img[alt="SSS Currency"]');
    
    if (!priceElement || !buyButton || !sssImage) return;
    
    const price = parseFloat(priceElement.textContent.trim());
    if (isNaN(price)) return;
    
    const percentage = Math.min(100, Math.floor((totalCurrentSSS / price) * 100));
    
    const sssNeeded = Math.max(0, price - totalCurrentSSS);
    const playtestsNeeded = Math.ceil(sssNeeded / avgSSSPerPlaytest);
    
    const shippingData = JSON.parse(localStorage.getItem('shibaShippingData') || '{}');
    let currentTotalHours = 0;
    for (const [gameName, data] of Object.entries(shippingData)) {
      if (data.schedule && data.schedule.totalMinutes) {
        currentTotalHours += data.schedule.totalMinutes / 60;
      }
    }
    
    const additionalHoursNeeded = playtestsNeeded * 2;
    const totalHoursRequired = currentTotalHours + additionalHoursNeeded;
    
    const additionalHours = Math.floor(additionalHoursNeeded);
    const additionalMinutes = Math.round((additionalHoursNeeded % 1) * 60);
    const totalHours = Math.floor(totalHoursRequired);
    const totalMinutes = Math.round((totalHoursRequired % 1) * 60);
    
    const estimate = document.createElement('div');
    estimate.className = 'shiba-estimate-display';
    estimate.style.cssText = `
      font-size: 11px;
      color: #555;
      margin-top: 4px;
      padding: 4px 6px;
      background: rgba(0, 122, 204, 0.1);
      border-left: 2px solid #007acc;
      border-radius: 2px;
    `;
    
    if (sssNeeded > 0) {
      estimate.innerHTML = `
        <div>Progress: ${percentage}%</div>
        <div>🚢 ${playtestsNeeded} playtests needed</div>
        <div>⏰ ${additionalHours}h ${additionalMinutes}m more work</div>
        <div style="font-size: 10px; color: #777;">Total: ${totalHours}h ${totalMinutes}m</div>
      `;
    } else {
      const hoursForThisItem = (price / avgSSSPerPlaytest) * 2;
      const itemHours = Math.floor(hoursForThisItem);
      const itemMinutes = Math.round((hoursForThisItem % 1) * 60);
      
      estimate.innerHTML = `
        <div>Progress: 100% ✅</div>
        <div style="color: #28a745;">Can afford now!</div>
        <div style="font-size: 10px; color: #777;">~${itemHours}h ${itemMinutes}m worth of work</div>
      `;
    }
    
    const priceContainer = item.querySelector('div[style*="display: flex; justify-content: space-between"]');
    if (priceContainer) {
      priceContainer.parentNode.insertBefore(estimate, priceContainer.nextSibling);
    } else {
      item.appendChild(estimate);
    }
  });
}

async function processRadarChart() {
  
  const radarSection = document.querySelector('h3[style*="font-size: 16px"], h3');
  if (!radarSection || !radarSection.textContent.includes('Game Radar Chart')) {
    return;
  }
  
  
  const existing = document.querySelector('.shiba-extension-display');
  if (existing) {
    existing.remove();
  }
  
  const gameName = getCurrentGameName();
  if (!gameName) return;
  
  let radarValues = [];
  const apiData = await getGameData();

  if (apiData && Array.isArray(apiData)) {
    const currentGame = apiData.find(game => game.name === gameName);
    if (currentGame) {
      radarValues = [
        currentGame.AverageFunScore || 0,
        currentGame.AverageArtScore || 0,
        currentGame.AverageCreativityScore || 0,
        currentGame.AverageAudioScore || 0,
        currentGame.AverageMoodScore || 0
      ];
      
      const averageSSSPerPlaytest = radarValues.reduce((a, b) => a + b, 0);
      
      let shippingHours = 0;
      const shippingData = getShippingData(gameName);
      if (shippingData && shippingData.schedule && shippingData.schedule.ships.length > 0) {
        const lastShip = shippingData.schedule.ships[shippingData.schedule.ships.length - 1];
        shippingHours = lastShip.cumulativeMinutes / 60;
      } else {
        shippingHours = currentGame.posts ? currentGame.posts.reduce((sum, post) => sum + (post.hoursSpent || 0), 0) : 0;
      }
      
      const sssPerHour = shippingHours > 0 ? (averageSSSPerPlaytest * currentGame.numberComplete) / shippingHours : 0;
      
      saveGameData(gameName, averageSSSPerPlaytest, currentGame.numberComplete || 0);
      
      setTimeout(scanCurrentGamePage, 1000);
      
      const display = document.createElement('div');
      display.className = 'shiba-extension-display';
      display.style.cssText = `
        margin-top: 16px;
        font-size: 14px;
        color: #666;
      `;
      
      display.innerHTML = `
          <div><strong>SSS/playtest:</strong> ${averageSSSPerPlaytest.toFixed(1)}</div>
          <div><strong>SSS/hour:</strong> ${sssPerHour.toFixed(1)}</div>
      `;
      
      
      const basedOnText = document.querySelector('div[style*="margin-bottom: 8px"][style*="color: rgb(102, 102, 102)"]');
      if (basedOnText) {
        basedOnText.parentNode.insertBefore(display, basedOnText);
      } else {
        radarSection.parentNode.insertBefore(display, radarSection.nextSibling);
      }
      
    }
  }
}

setupRequestInterception();

window.addEventListener('load', function() {
  const url = window.location.href;
  
  const isGamesPage = url.includes('shiba.hackclub.com/my-games');
  const isShopPage = url.includes('shiba.hackclub.com/shop');
  
  if (isGamesPage) {
    setTimeout(() => {
      if (!interceptedGameData) {
        getGameData();
      }
    }, 5000);
    document.addEventListener('click', function(event) {
      if (event.target.closest('.pop-seq-item')) {
        setTimeout(processRadarChart, 200);
      }
    });
    
  } else if (isShopPage) {
    setTimeout(processShopItems, 500);
  }
});