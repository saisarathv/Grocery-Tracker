import { auth, provider, db } from './firebase-config.js';
import { signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, setDoc, getDoc, onSnapshot, collection, enableIndexedDbPersistence, runTransaction } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Add these functions at the very top of your script.js file, before any other code
function getItemsFromStorage() {
  return localStorage.getItem('items') ? JSON.parse(localStorage.getItem('items')) : [];
}

function getHistoryItems() {
  return localStorage.getItem('historyItems') ? JSON.parse(localStorage.getItem('historyItems')) : [];
}

function getReceipts() {
  return localStorage.getItem('receipts') ? JSON.parse(localStorage.getItem('receipts')) : [];
}

function getCurrencySymbol(currency) {
  const symbols = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    INR: '₹',
    JPY: '¥',
    AUD: 'A$',
    CAD: 'C$'
  };
  return symbols[currency] || currency;
}

// Move these functions outside of init()
window.generateMonthlyReport = function() {
  const currentDate = new Date();
  const currentMonth = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();
  
  // Get all data
  const items = getItemsFromStorage();
  const historyItems = getHistoryItems();
  const receipts = getReceipts();
  
  // Filter for current month
  const monthlyData = {
    current: items.filter(item => item.status === 'current'),
    shopping: items.filter(item => item.status === 'need'),
    completed: historyItems.filter(item => {
      const itemDate = new Date(item.movedDate);
      return item.type === 'completed' && 
             itemDate.getMonth() === currentMonth && 
             itemDate.getFullYear() === currentYear;
    }),
    wasted: historyItems.filter(item => {
      const itemDate = new Date(item.movedDate);
      return item.type === 'wasted' && 
             itemDate.getMonth() === currentMonth && 
             itemDate.getFullYear() === currentYear;
    }),
    receipts: receipts.filter(receipt => {
      const receiptDate = new Date(receipt.date);
      return receiptDate.getMonth() === currentMonth && 
             receiptDate.getFullYear() === currentYear;
    })
  };
  
  // Get budget information
  const budget = parseFloat(localStorage.getItem('monthlyBudget')) || 0;
  const currency = localStorage.getItem('selectedCurrency') || 'USD';
  const currencySymbol = getCurrencySymbol(currency);
  
  // Generate CSV content
  let csvContent = '\ufeff'; // Add BOM for Excel compatibility
  csvContent += 'Smart Grocery Manager - Monthly Report\n';
  csvContent += `Month: ${currentDate.toLocaleString('default', { month: 'long' })} ${currentYear}\n\n`;
  csvContent += `Monthly Budget: ${currencySymbol}${budget.toFixed(2)}\n\n`;
  
  // Current Items
  csvContent += 'CURRENT ITEMS IN STOCK\n';
  csvContent += 'Name,Quantity,Expiry Date,Status\n';
  monthlyData.current.forEach(item => {
    csvContent += `"${item.name}",${item.quantity},"${item.expiry || 'N/A'}","In Stock"\n`;
  });
  
  // Shopping List
  csvContent += '\nSHOPPING LIST\n';
  csvContent += 'Name,Quantity,Estimated Price,Total\n';
  monthlyData.shopping.forEach(item => {
    const total = item.isUnknownPrice ? 'Unknown' : `${currencySymbol}${(item.price * item.quantity).toFixed(2)}`;
    csvContent += `"${item.name}",${item.quantity},"${item.isUnknownPrice ? 'Unknown' : `${currencySymbol}${item.price}`}","${total}"\n`;
  });
  
  // Completed Items
  csvContent += '\nCOMPLETED ITEMS\n';
  csvContent += 'Name,Quantity,Date Completed\n';
  monthlyData.completed.forEach(item => {
    csvContent += `"${item.name}",${item.quantity},"${new Date(item.movedDate).toLocaleDateString()}"\n`;
  });
  
  // Wasted Items
  csvContent += '\nWASTED ITEMS\n';
  csvContent += 'Name,Quantity,Date Wasted\n';
  monthlyData.wasted.forEach(item => {
    csvContent += `"${item.name}",${item.quantity},"${new Date(item.movedDate).toLocaleDateString()}"\n`;
  });
  
  // Receipts
  csvContent += '\nRECEIPTS\n';
  csvContent += 'Description,Date,Amount\n';
  monthlyData.receipts.forEach(receipt => {
    csvContent += `"${receipt.name}","${new Date(receipt.date).toLocaleDateString()}","${currencySymbol}${receipt.amount}"\n`;
  });
  
  // Summary
  const totalSpent = monthlyData.receipts.reduce((sum, receipt) => sum + parseFloat(receipt.amount), 0);
  csvContent += '\nMONTHLY SUMMARY\n';
  csvContent += `Total Budget,${currencySymbol}${budget.toFixed(2)}\n`;
  csvContent += `Total Spent,${currencySymbol}${totalSpent.toFixed(2)}\n`;
  csvContent += `Remaining Budget,${currencySymbol}${(budget - totalSpent).toFixed(2)}\n`;
  
  return csvContent;
};

window.downloadMonthlyReport = function() {
  try {
    const csvContent = window.generateMonthlyReport();
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const currentDate = new Date();
    const fileName = `grocery-report-${currentDate.toLocaleString('default', { month: 'long' })}-${currentDate.getFullYear()}.csv`;
    
    if (navigator.msSaveBlob) { // IE 10+
      navigator.msSaveBlob(blob, fileName);
    } else {
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  } catch (error) {
    console.error('Error downloading report:', error);
    if (window.showCustomDialog) {
      window.showCustomDialog('Error generating report. Please try again.', 'alert');
    } else {
      alert('Error generating report. Please try again.');
    }
  }
};

// Add this at the top level of your script, outside any function
document.addEventListener('DOMContentLoaded', function() {
  const downloadBtn = document.getElementById('download-monthly-data');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', window.downloadMonthlyReport);
  }
});

document.addEventListener('DOMContentLoaded', init);

function init() {
  const itemForm = document.getElementById('item-form');
  const itemInput = document.getElementById('item-input');
  const quantityInput = document.getElementById('quantity-input');
  const statusInput = document.getElementById('status-input');
  const currentList = document.getElementById('current-list');
  const needList = document.getElementById('need-list');
  const clearBtn = document.getElementById('clear');
  const filterInput = document.getElementById('filter');
  const expiryInput = document.getElementById('expiry-input');
  const priceInput = document.getElementById('price-input');
  const expiringList = document.getElementById('expiring-list');
  const totalAmount = document.getElementById('total-amount');
  const currencySelect = document.getElementById('currency-select');
  const unknownPriceCheckbox = document.getElementById('unknown-price-checkbox');
  const noExpiryCheckbox = document.getElementById('no-expiry-checkbox');
  const receiptForm = document.getElementById('receipt-form');
  const receiptsList = document.getElementById('receipts-list');
  const monthlyBudgetInput = document.getElementById('monthly-budget');
  const setBudgetBtn = document.querySelector('.set-budget-btn');
  const currentBudgetDisplay = document.getElementById('current-budget');
  const spentAmountDisplay = document.getElementById('spent-amount');
  const remainingBudgetDisplay = document.getElementById('remaining-budget');
  const sortSelect = document.getElementById('sort-items');

  let isEditMode = false;
  let editItem = null;

  let currentUser = null;
  let unsubscribeSnapshot = null;

  // Add connection state monitoring
  let isOnline = window.navigator.onLine;
  window.addEventListener('online', handleOnlineStatus);
  window.addEventListener('offline', handleOnlineStatus);

  function handleOnlineStatus() {
    isOnline = window.navigator.onLine;
    console.log('Connection status:', isOnline ? 'online' : 'offline');
    if (isOnline && currentUser) {
      syncDataWithServer();
    }
  }

  // Add this function to handle data synchronization
  async function syncDataWithServer() {
    if (!currentUser || !isOnline) return;

    try {
      console.log('Starting sync with server...');
      const userDoc = doc(db, 'users', currentUser.uid);
      
      // First, get the server data
      const docSnap = await getDoc(userDoc);
      console.log('Got server data:', docSnap.exists());
      
      let serverData = docSnap.exists() ? docSnap.data() : null;
      
      // Get local data
      const localItems = getItemsFromStorage();
      const localReceipts = getReceipts();
      const localBudget = localStorage.getItem('monthlyBudget') || '0';
      const localHistoryItems = getHistoryItems();
      
      console.log('Local data:', {
        itemsCount: localItems.length,
        receiptsCount: localReceipts.length,
        historyItemsCount: localHistoryItems.length,
        budget: localBudget
      });
      
      try {
        if (serverData) {
          // Merge data with server's data
          const mergedItems = mergeData(localItems, serverData.items || []);
          const mergedReceipts = mergeData(localReceipts, serverData.receipts || []);
          const mergedHistoryItems = mergeData(localHistoryItems, serverData.historyItems || []);
          const mergedBudget = serverData.monthlyBudget || localBudget;
          
          // Update local storage with merged data
          localStorage.setItem('items', JSON.stringify(mergedItems));
          localStorage.setItem('receipts', JSON.stringify(mergedReceipts));
          localStorage.setItem('historyItems', JSON.stringify(mergedHistoryItems));
          localStorage.setItem('monthlyBudget', mergedBudget);
          
          // Update server with merged data
          await setDoc(userDoc, {
            items: mergedItems,
            receipts: mergedReceipts,
            historyItems: mergedHistoryItems,
            monthlyBudget: mergedBudget,
            lastUpdated: Date.now(),
            userId: currentUser.uid
          });
          
          console.log('Sync completed successfully');
        } else {
          // If no server data exists, push local data to server
          await setDoc(userDoc, {
            items: localItems,
            receipts: localReceipts,
            historyItems: localHistoryItems,
            monthlyBudget: localBudget,
            lastUpdated: Date.now(),
            userId: currentUser.uid
          });
          
          console.log('Initial data push completed');
        }
        
        // Refresh all displays
        displayItems();
        displayReceipts();
        displayHistoryItems();
        updateBudgetStats();
        
      } catch (writeError) {
        console.error('Error writing to Firestore:', writeError);
        throw writeError;
      }
      
    } catch (error) {
      console.error('Error during sync:', error);
      throw error;
    }
  }

  currencySelect.addEventListener('change', function() {
    const newCurrency = this.value;
    localStorage.setItem('selectedCurrency', newCurrency);
    
    // Update all displays that show currency
    updateAllCurrencyDisplays(newCurrency);
  });

  unknownPriceCheckbox.addEventListener('change', function() {
    if (this.checked) {
      priceInput.value = '';
      priceInput.disabled = true;
      priceInput.placeholder = 'Price Unknown';
    } else {
      priceInput.disabled = false;
      priceInput.placeholder = 'Enter Price per Item';
    }
  });

  noExpiryCheckbox.addEventListener('change', function() {
    if (this.checked) {
      expiryInput.value = '';
      expiryInput.disabled = true;
      expiryInput.style.backgroundColor = '#f5f5f5';
    } else {
      expiryInput.disabled = false;
      expiryInput.style.backgroundColor = '';
    }
  });

  const savedCurrency = localStorage.getItem('selectedCurrency') || 'USD';
  currencySelect.value = savedCurrency;

  const savedBudget = localStorage.getItem('monthlyBudget');
  if (savedBudget) {
    const budgetAmount = parseFloat(savedBudget);
    monthlyBudgetInput.value = budgetAmount;
    const currencySymbol = getCurrencySymbol(currencySelect.value);
    currentBudgetDisplay.textContent = `${currencySymbol}${budgetAmount.toFixed(2)}`;
  }

  if (setBudgetBtn) {
    setBudgetBtn.addEventListener('click', async function(e) {
      e.preventDefault();
      const budgetAmount = parseFloat(monthlyBudgetInput.value);
      
      if (isNaN(budgetAmount) || budgetAmount < 0) {
        await showCustomDialog('Please enter a valid budget amount', 'alert');
        return;
      }
      
      const currentBudget = parseFloat(localStorage.getItem('monthlyBudget')) || 0;
      
      if (currentBudget !== 0 && budgetAmount === currentBudget) {
        await showCustomDialog('The budget amount is the same as the current budget. Please enter a different amount.', 'alert');
        return;
      }
      
      const message = currentBudget === 0 ? 
        'Are you sure you about the Budget amount?' : 
        'Are you sure you want to change the Budget amount?';
      
      const confirmed = await showCustomDialog(message);
      if (confirmed) {
        localStorage.setItem('monthlyBudget', budgetAmount.toString());
        const currencySymbol = getCurrencySymbol(currencySelect.value);
        currentBudgetDisplay.textContent = `${currencySymbol}${budgetAmount.toFixed(2)}`;
        
        if (currentUser) {
          try {
            const userDoc = doc(db, 'users', currentUser.uid);
            await setDoc(userDoc, {
              items: getItemsFromStorage(),
              receipts: getReceipts(),
              monthlyBudget: budgetAmount.toString(),
              lastUpdated: Date.now()
            });
          } catch (error) {
            console.error('Error syncing budget:', error);
            await showCustomDialog('Error syncing budget. Please try again.', 'alert');
          }
        }
        
        updateBudgetStats();
      } else {
        monthlyBudgetInput.value = currentBudget;
      }
    });
  }

  initializeForm();

  displayItems();

  initializeReceiptsSection();

  displayReceipts();

  updateBudgetStats();

  itemForm.addEventListener('submit', async function(e) {
    e.preventDefault();

    const itemName = itemInput.value.trim();
    const itemQuantity = parseInt(quantityInput.value);
    const itemStatus = statusInput.value;
    const itemExpiry = noExpiryCheckbox.checked ? '' : expiryInput.value;
    const itemPrice = unknownPriceCheckbox.checked ? 0 : parseFloat(priceInput.value) || 0;

    // Only validate if the values are invalid
    if (!itemName || itemName === '') {
      await showCustomDialog('Please enter an item name', 'alert');
      return;
    }

    if (!itemQuantity || isNaN(itemQuantity) || itemQuantity < 1) {
      await showCustomDialog('Please enter a valid quantity', 'alert');
      return;
    }

    if (itemStatus === 'current' && !noExpiryCheckbox.checked && !itemExpiry) {
      await showCustomDialog('Please select an expiry date or check "Expiry N/A"', 'alert');
      return;
    }

    if (itemStatus === 'need' && !unknownPriceCheckbox.checked && (!itemPrice || itemPrice <= 0)) {
      await showCustomDialog('Please enter a valid price or check "Price N/A"', 'alert');
      return;
    }

    // Check for duplicates only when adding new items
    if (!isEditMode && isDuplicateItem(itemName, itemStatus)) {
      await showCustomDialog('This item already exists in the current list!', 'alert');
      return;
    }

    try {
      if (isEditMode) {
        // Update the item
        updateLocalStorage(itemName, itemQuantity, itemStatus, itemExpiry, itemPrice);
        editItemInDOM(itemName, itemQuantity, itemStatus, itemExpiry, itemPrice);
        
        // Reset submit button text
        const submitButton = itemForm.querySelector('button[type="submit"]');
        submitButton.innerHTML = '<i class="fa-solid fa-plus"></i> Add Item';
      } else {
        // Add new item
        addItemToDOM(itemName, itemQuantity, itemStatus, itemExpiry, itemPrice);
        addItemToLocalStorage(itemName, itemQuantity, itemStatus, itemExpiry, itemPrice);
      }

      // Reset form and its state
      itemForm.reset();
      unknownPriceCheckbox.checked = false;
      noExpiryCheckbox.checked = false;
      priceInput.disabled = false;
      expiryInput.disabled = false;
      
      // Reset price input placeholder
      priceInput.placeholder = 'Enter Price per Item';
      
      // Initialize form to show/hide appropriate fields
      initializeForm();
    } catch (error) {
      await showCustomDialog('An error occurred while saving the item', 'alert');
    }
  });

  // Add event listeners for all lists
  document.getElementById('current-list-with-expiry').addEventListener('click', handleItemClick);
  document.getElementById('current-list-no-expiry').addEventListener('click', handleItemClick);
  needList.addEventListener('click', handleItemClick);
  expiringList.addEventListener('click', handleItemClick);

  function handleItemClick(e) {
    const targetElement = e.target.closest('button');
    if (!targetElement) return;

    const listItem = targetElement.closest('li');
    if (!listItem) return;
    
    if (targetElement.classList.contains('remove-item') || 
        targetElement.querySelector('.fa-xmark')) {
        removeItem(listItem);
    } else if (targetElement.classList.contains('edit-item') || 
               targetElement.querySelector('.fa-pen')) {
        editMode(listItem);
    } else if (targetElement.classList.contains('move-item') || 
               targetElement.querySelector('.fa-check')) {
        showMoveDialog(listItem);
    } else if (targetElement.classList.contains('complete-item')) {
        moveItemToHistory(listItem, 'completed');
    } else if (targetElement.classList.contains('waste-item')) {
        moveItemToHistory(listItem, 'wasted');
    }
  }

  function editMode(item) {
    if (!item) return;
    
    // Remove edit-mode-item class from any previously edited items
    document.querySelectorAll('.edit-mode-item').forEach(item => {
      item.classList.remove('edit-mode-item');
    });
    
    isEditMode = true;
    editItem = item;
    
    const itemText = item.querySelector('.item-name').textContent;
    const itemQuantityText = item.querySelector('.item-quantity').textContent;
    const quantity = parseInt(itemQuantityText);
    
    // Determine status based on which list contains the item
    let itemStatus;
    if (item.closest('#need-list')) {
      itemStatus = 'need';
    } else {
      itemStatus = 'current';
    }
    
    let itemExpiry = '';
    let itemPrice = 0;
    
    // Reset checkboxes and enable inputs first
    noExpiryCheckbox.checked = false;
    unknownPriceCheckbox.checked = false;
    expiryInput.disabled = false;
    priceInput.disabled = false;
    
    if (itemStatus === 'current') {
      const expirySpan = item.querySelector('.item-expiry');
      if (expirySpan) {
        const expiryText = expirySpan.textContent;
        if (expiryText.includes('N/A')) {
          noExpiryCheckbox.checked = true;
          expiryInput.disabled = true;
          expiryInput.value = '';
        } else {
          const expiryMatch = expiryText.match(/(Expires: |Expired on: )(.*)/);
          if (expiryMatch) {
            const expiryDate = new Date(expiryMatch[2]);
            // Format date for input without timezone adjustment
            itemExpiry = expiryDate.toISOString().split('T')[0];
            noExpiryCheckbox.checked = false;
            expiryInput.disabled = false;
          }
        }
      }
    } else {
      const priceSpan = item.querySelector('.item-price');
      if (priceSpan) {
        if (priceSpan.textContent.includes('Unknown')) {
          unknownPriceCheckbox.checked = true;
          priceInput.disabled = true;
          priceInput.value = '';
        } else {
          const priceMatch = priceSpan.textContent.match(/[\d.]+/);
          if (priceMatch) {
            itemPrice = parseFloat(priceMatch[0]);
            unknownPriceCheckbox.checked = false;
            priceInput.disabled = false;
          }
        }
      }
    }
    
    // Update form inputs
    itemInput.value = itemText;
    quantityInput.value = quantity;
    statusInput.value = itemStatus;
    expiryInput.value = itemExpiry;
    priceInput.value = itemPrice || '';
    
    // Update form display based on status
    if (itemStatus === 'current') {
      document.querySelector('.date-container').style.display = 'block';
      document.querySelector('.price-container').style.display = 'none';
    } else {
      document.querySelector('.date-container').style.display = 'none';
      document.querySelector('.price-container').style.display = 'flex';
    }
    
    // Update submit button text
    const submitButton = itemForm.querySelector('button[type="submit"]');
    submitButton.innerHTML = '<i class="fa-solid fa-pen"></i> Update Item';
    
    // Add edit mode class to item
    item.classList.add('edit-mode-item');
    
    // Scroll to form
    itemForm.scrollIntoView({ behavior: 'smooth' });
  }

  function initializeForm() {
    const currentStatus = statusInput.value;
    if (currentStatus === 'current') {
      document.querySelector('.date-container').style.display = 'block';
      document.querySelector('.price-container').style.display = 'none';
      priceInput.value = '';
      priceInput.placeholder = 'Enter Price per Item';
      unknownPriceCheckbox.checked = false;
      priceInput.disabled = false;
    } else {
      document.querySelector('.date-container').style.display = 'none';
      document.querySelector('.price-container').style.display = 'flex';
      expiryInput.value = '';
      priceInput.placeholder = 'Enter Price per Item';
    }
  }

  function updateBudgetStats() {
    updateBudgetDashboard();
  }

  function initializeReceiptsSection() {
    const receiptsList = document.getElementById('receipts-list');
    const showReceiptsBtn = document.getElementById('show-receipts-btn');
    
    if (!receiptsList || !showReceiptsBtn) return;
    
    // Initially hide receipts and set button text to "View Receipts"
    receiptsList.style.display = 'none';
    showReceiptsBtn.innerHTML = '<i class="fas fa-receipt"></i> View Receipts';
    
    // Remove existing event listener and add new one
    const newShowReceiptsBtn = showReceiptsBtn.cloneNode(true);
    showReceiptsBtn.parentNode.replaceChild(newShowReceiptsBtn, showReceiptsBtn);
    
    newShowReceiptsBtn.addEventListener('click', function() {
        const isHidden = receiptsList.style.display === 'none';
        receiptsList.style.display = isHidden ? 'grid' : 'none';
        this.innerHTML = isHidden 
            ? '<i class="fas fa-times"></i> Hide Receipts'
            : '<i class="fas fa-receipt"></i> View Receipts';
    });
  }

  function displayItems(sortMethod = 'alphabetical') {
    document.getElementById('current-list-with-expiry').innerHTML = '';
    document.getElementById('current-list-no-expiry').innerHTML = '';
    needList.innerHTML = '';
    expiringList.innerHTML = '';
    
    let items = getItemsFromStorage();
    
    // Sort items based on selected method
    if (sortMethod === 'expiry') {
        items.sort((a, b) => {
            // If both items have expiry dates
            if (a.expiry && b.expiry) {
                const dateA = new Date(a.expiry + 'T00:00:00Z');
                const dateB = new Date(b.expiry + 'T00:00:00Z');
                return dateA - dateB;
            }
            // If only one item has expiry date
            if (a.expiry) return -1;  // a comes first
            if (b.expiry) return 1;   // b comes first
            // If neither has expiry date, sort alphabetically
            return a.name.localeCompare(b.name);
        });
    } else {
        // Default alphabetical sorting
        items.sort((a, b) => a.name.localeCompare(b.name));
    }
    
    items.forEach(({ name, quantity, status, expiry, price, isUnknownPrice }) => {
        addItemToDOM(name, quantity, status, expiry, isUnknownPrice ? 0 : price);
    });
    
    checkUI();
  }

  function addItemToDOM(name, quantity, status, expiry = '', price = 0) {
    const listItem = document.createElement('li');
    const currencySymbol = getCurrencySymbol(currencySelect.value);
    
    const capitalizedName = name.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    
    let expiryDisplay = '';
    if (status === 'current') {
        if (expiry) {
            const expiryDate = new Date(expiry + 'T00:00:00Z');
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const daysUntilExpiry = Math.floor((expiryDate - today) / (1000 * 60 * 60 * 24));
            
            let expiryStatus = '';
            let expiryPrefix = 'Expires: ';
            
            if (daysUntilExpiry < 0) {
                expiryStatus = 'expired';
                expiryPrefix = 'Expired: ';
            } else if (daysUntilExpiry <= 3) {
                expiryStatus = 'expiring';
            }
            
            expiryDisplay = `<span class="item-expiry ${expiryStatus}">
                ${expiryPrefix}${new Date(expiry).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    timeZone: 'UTC'
                })}
            </span>`;
        } else {
            expiryDisplay = '<span class="item-expiry">Expires: N/A</span>';
        }
    }
    
    listItem.innerHTML = `
        <div class="item-details">
            <div class="item-name">${capitalizedName}</div>
            <div class="item-info">
                <span class="item-quantity">${quantity} units</span>
                ${status === 'current' ? 
                    expiryDisplay 
                    : 
                    (price === 0 ? 
                        '<span class="item-price">Price: Unknown</span>' 
                        : 
                        `<span class="item-price">${currencySymbol}${price.toFixed(2)} × ${quantity} = ${currencySymbol}${(price * quantity).toFixed(2)}</span>`
                    )
                }
            </div>
        </div>
        <div class="item-actions">
            ${status === 'need' ? 
                '<button class="move-item btn-link"><i class="fa-solid fa-check"></i></button>' 
                : ''
            }
            ${status === 'current' ? `
                <button class="complete-item btn-link" title="Mark as Completed">
                    <i class="fa-solid fa-check-circle"></i>
                </button>
                <button class="waste-item btn-link" title="Mark as Wasted">
                    <i class="fa-solid fa-trash-alt"></i>
                </button>
            ` : ''}
            <button class="edit-item btn-link">
                <i class="fa-solid fa-pen"></i>
            </button>
            <button class="remove-item btn-link text-red">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
    `;

    // Get the appropriate list
    let targetList;
    if (status === 'current') {
        if (isExpiringSoon(expiry)) {
            targetList = expiringList;
        } else {
            // Split between with-expiry and no-expiry lists
            targetList = expiry 
                ? document.getElementById('current-list-with-expiry')
                : document.getElementById('current-list-no-expiry');
        }
    } else {
        targetList = needList;
    }

    // Simply append the item (no sorting here)
    targetList.appendChild(listItem);
    
    updateTotalAmount();
    updateBudgetStats();
  }

  async function addItemToLocalStorage(name, quantity, status, expiry = '', price = 0) {
    let items = getItemsFromStorage();
    const capitalizedName = name.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    
    const newItem = { 
      id: Date.now().toString(),
      name: capitalizedName, 
      quantity, 
      status, 
      expiry: noExpiryCheckbox.checked ? '' : expiry, 
      price: status === 'need' && unknownPriceCheckbox.checked ? 0 : price,
      isUnknownPrice: status === 'need' && unknownPriceCheckbox.checked,
      timestamp: Date.now()
    };
    
    items.push(newItem);
    localStorage.setItem('items', JSON.stringify(items));
    
    if (currentUser) {
      try {
        const userDoc = doc(db, 'users', currentUser.uid);
        // Get existing history items before updating
        const historyItems = getHistoryItems();
        
        await setDoc(userDoc, {
          items,
          receipts: getReceipts(),
          historyItems: historyItems, // Preserve history items
          monthlyBudget: localStorage.getItem('monthlyBudget') || '0',
          lastUpdated: Date.now()
        }, { merge: true }); // Add merge: true to preserve existing data
      } catch (error) {
        console.error('Error syncing data:', error);
        await showCustomDialog('Error syncing data. Please try again.', 'alert');
      }
    }
    
    displayItems();
    displayHistoryItems(); // Add this to refresh history items
    updateTotalAmount();
  }

  function editItemInDOM(name, quantity, status, expiry, price) {
    if (!editItem) return;
    
    // Remove the old item from DOM
    editItem.classList.remove('edit-mode-item');
    editItem.remove();
    
    // Add the updated item
    addItemToDOM(name, quantity, status, expiry, price);
    
    // Reset edit mode
    isEditMode = false;
    editItem = null;
    
    // Reset submit button text
    const submitButton = itemForm.querySelector('button[type="submit"]');
    submitButton.innerHTML = '<i class="fa-solid fa-plus"></i> Add Item';
  }

  async function updateLocalStorage(name, quantity, status, expiry = '', price = 0) {
    let items = getItemsFromStorage();
    const oldItemName = editItem.querySelector('.item-name').textContent;
    
    const updatedItem = {
      id: Date.now().toString(),
      name: name,
      quantity: quantity,
      status: status,
      expiry: noExpiryCheckbox.checked ? '' : expiry,
      price: status === 'need' && unknownPriceCheckbox.checked ? 0 : price,
      isUnknownPrice: status === 'need' && unknownPriceCheckbox.checked,
      timestamp: Date.now()
    };
    
    items = items.map(item => 
      item.name === oldItemName ? updatedItem : item
    );
    
    localStorage.setItem('items', JSON.stringify(items));
    
    if (currentUser) {
      try {
        const userDoc = doc(db, 'users', currentUser.uid);
        await setDoc(userDoc, {
          items,
          receipts: getReceipts(),
          monthlyBudget: localStorage.getItem('monthlyBudget') || '0',
          lastUpdated: Date.now()
        });
      } catch (error) {
        console.error('Error syncing update:', error);
        await showCustomDialog('Error syncing update. Please try again.', 'alert');
      }
    }
    
    updateTotalAmount();
    updateBudgetStats();
  }

  function removeItem(item) {
    if (confirm('Are you sure you want to remove this item?')) {
      const itemName = item.querySelector('.item-name').textContent;
      item.remove();
      removeItemFromStorage(itemName);
      checkUI();
      updateBudgetStats();
    }
  }

  async function removeItemFromStorage(name) {
    let items = getItemsFromStorage();
    items = items.filter((item) => item.name !== name);
    localStorage.setItem('items', JSON.stringify(items));
    
    if (currentUser) {
      try {
        const userDoc = doc(db, 'users', currentUser.uid);
        // Get existing history items before updating
        const historyItems = getHistoryItems();
        
        await setDoc(userDoc, {
          items,
          receipts: getReceipts(),
          historyItems: historyItems, // Preserve history items
          monthlyBudget: localStorage.getItem('monthlyBudget') || '0',
          lastUpdated: Date.now()
        }, { merge: true }); // Add merge: true to preserve existing data
      } catch (error) {
        console.error('Error syncing deletion:', error);
        await showCustomDialog('Error syncing deletion. Please try again.', 'alert');
      }
    }
    
    updateTotalAmount();
    displayHistoryItems(); // Add this to refresh history items
  }

  function isDuplicateItem(name, status) {
    const items = getItemsFromStorage();
    if (status === 'need') {
      return false;
    } else {
      return items.some(item => 
        item.name.toLowerCase() === name.toLowerCase() && 
        (item.status === 'current')
      );
    }
  }

  function checkUI() {
    const hasItems = 
        document.getElementById('current-list-with-expiry').children.length > 0 || 
        document.getElementById('current-list-no-expiry').children.length > 0 || 
        needList.children.length > 0 || 
        expiringList.children.length > 0;
    filterInput.style.display = hasItems ? 'block' : 'none';
  }

  function isExpiringSoon(expiryDate) {
    if (!expiryDate) return false;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Create date without timezone offset
    const expiry = new Date(expiryDate + 'T00:00:00Z');
    
    const daysUntilExpiry = Math.floor((expiry - today) / (1000 * 60 * 60 * 24));
    
    return daysUntilExpiry <= 3;
  }

  // Update the updateTotalAmount function
  function updateTotalAmount() {
    const items = getItemsFromStorage();
    const needItems = items.filter(item => item.status === 'need');
    const total = needItems
        .filter(item => item.price > 0)
        .reduce((sum, item) => sum + (parseFloat(item.price) * parseInt(item.quantity)), 0);
    
    const currencySymbol = getCurrencySymbol(currencySelect.value);
    const unknownPriceItems = needItems.filter(item => item.price === 0).length;
    
    const totalAmountElement = document.getElementById('total-amount');
    
    // Preserve the calculator icon and styling while updating the text
    totalAmountElement.innerHTML = `
        <div class="main-total">
            <i class="fas fa-calculator"></i>
            Estimated Total: ${currencySymbol}${total.toFixed(2)}
        </div>
        ${unknownPriceItems > 0 ? 
            `<div class="total-amount-subtitle">${unknownPriceItems} item${unknownPriceItems > 1 ? 's' : ''}, price unknown</div>` 
            : ''}
    `;
  }

  setInterval(() => {
    const items = getItemsFromStorage();
    items.forEach(item => {
      if (item.status === 'current' && isExpiringSoon(item.expiry)) {
        alert(`${item.name} is expiring soon! Expiry date: ${item.expiry}`);
      }
    });
  }, 86400000);

  function checkAndMoveExpiringItems() {
    const items = getItemsFromStorage();
    currentList.innerHTML = '';
    expiringList.innerHTML = '';
    
    items.forEach(item => {
      if (item.status === 'current') {
        addItemToDOM(item.name, item.quantity, item.status, item.expiry, item.price);
      }
    });
  }

  setInterval(checkAndMoveExpiringItems, 3600000);

  function clearSection(listType) {
    // Remove the duplicate confirmation since it's already handled in the clear menu click event
    let items = getItemsFromStorage();
    
    switch(listType) {
        case 'all':
            localStorage.removeItem('items');
            localStorage.removeItem('receipts');
            document.querySelectorAll('.items').forEach(list => list.innerHTML = '');
            document.getElementById('receipts-list').innerHTML = '';
            break;
        case 'current':
            const filteredCurrent = items.filter(item => 
                item.status !== 'current' || isExpiringSoon(item.expiry));
            localStorage.setItem('items', JSON.stringify(filteredCurrent));
            document.getElementById('current-list-with-expiry').innerHTML = '';
            document.getElementById('current-list-no-expiry').innerHTML = '';
            break;
        case 'expiring':
            const filteredExpiring = items.filter(item => !isExpiringSoon(item.expiry));
            localStorage.setItem('items', JSON.stringify(filteredExpiring));
            document.getElementById('expiring-list').innerHTML = '';
            break;
        case 'need':
            const filteredNeed = items.filter(item => item.status !== 'need');
            localStorage.setItem('items', JSON.stringify(filteredNeed));
            document.getElementById('need-list').innerHTML = '';
            break;
        case 'receipts':
            localStorage.removeItem('receipts');
            document.getElementById('receipts-list').innerHTML = '';
            break;
    }
    
    // Sync with Firestore if user is logged in
    if (currentUser) {
        const userDoc = doc(db, 'users', currentUser.uid);
        setDoc(userDoc, {
            items: getItemsFromStorage(),
            receipts: getReceipts(),
            monthlyBudget: localStorage.getItem('monthlyBudget') || '0',
            lastUpdated: Date.now()
        }).catch(error => {
            console.error('Error syncing after clear:', error);
        });
    }
    
    updateTotalAmount();
    updateBudgetStats();
    checkUI();
  }

  // Add these helper functions at the top of your script
  function compressImage(base64String, maxWidth = 800) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = base64String;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            
            // Calculate new dimensions
            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }
            
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            // Compress as JPEG with 0.7 quality
            resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = reject;
    });
  }

  // Add this function to manage storage
  async function manageStorage() {
    const receipts = getReceipts();
    if (receipts.length > 50) { // Keep only last 50 receipts
        receipts.sort((a, b) => b.timestamp - a.timestamp);
        receipts.splice(50); // Remove older receipts
        localStorage.setItem('receipts', JSON.stringify(receipts));
    }
  }

  // Update the handleReceiptUpload function
  async function handleReceiptUpload(e) {
    e.preventDefault();
    
    try {
        // Get form elements and validate they exist
        const receiptNameInput = document.getElementById('receipt-name');
        const receiptDateInput = document.getElementById('receipt-date');
        const receiptAmountInput = document.getElementById('receipt-amount');
        const receiptFileInput = document.getElementById('receipt-file');
        
        if (!receiptNameInput || !receiptDateInput || !receiptAmountInput || !receiptFileInput) {
            throw new Error('Required form elements not found');
        }
        
        // Get values
        const receiptName = receiptNameInput.value.trim();
        const receiptDate = receiptDateInput.value;
        const receiptAmount = receiptAmountInput.value.trim();
        const receiptFile = receiptFileInput.files[0];
        
        // Validate all fields are filled
        const missingFields = [];
        if (!receiptName) missingFields.push('Receipt Name');
        if (!receiptDate) missingFields.push('Date');
        if (!receiptAmount) missingFields.push('Amount');
        if (!receiptFile) missingFields.push('Receipt File');
        
        if (missingFields.length > 0) {
            await showCustomDialog(`Please fill in the following fields: ${missingFields.join(', ')}`, 'alert');
            return;
        }

        // Validate amount
        const amount = parseFloat(receiptAmount);
        if (isNaN(amount) || amount < 0) {
            await showCustomDialog('Please enter a valid amount', 'alert');
            return;
        }

        // Compress image if it's an image file
        let fileData;
        if (receiptFile.type.startsWith('image/')) {
            const reader = new FileReader();
            fileData = await new Promise((resolve, reject) => {
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(receiptFile);
            });
            
            // Compress the image
            fileData = await compressImage(fileData);
        } else {
            // For PDFs, limit file size
            if (receiptFile.size > 2 * 1024 * 1024) { // 2MB limit for PDFs
                await showCustomDialog('PDF files must be under 2MB', 'alert');
                return;
            }
            fileData = await readFileAsDataURL(receiptFile);
        }

        // Manage storage before adding new receipt
        await manageStorage();

        // Try to save to localStorage with error handling
        try {
            const newReceipt = {
                id: Date.now(),
                name: receiptName,
                date: receiptDate,
                amount: amount,
                file: fileData,
                type: receiptFile.type,
                timestamp: Date.now(),
                version: generateVersion(),
                pendingSync: !navigator.onLine
            };

            let existingReceipts = getReceipts();
            existingReceipts.push(newReceipt);
            
            try {
                localStorage.setItem('receipts', JSON.stringify(existingReceipts));
            } catch (storageError) {
                // If storage fails, try to free up space
                console.log('Storage failed, attempting to free space...');
                existingReceipts = existingReceipts.slice(-30); // Keep only last 30 receipts
                localStorage.setItem('receipts', JSON.stringify(existingReceipts));
                
                // Try one more time with the new receipt
                existingReceipts.push(newReceipt);
                try {
                    localStorage.setItem('receipts', JSON.stringify(existingReceipts));
                } catch (finalError) {
                    throw new Error('Storage quota exceeded even after cleanup');
                }
            }

            // If offline, store in pending updates
            if (!navigator.onLine) {
                const pendingUpdates = JSON.parse(localStorage.getItem('pendingUpdates') || '[]');
                pendingUpdates.push({
                    type: 'receipt',
                    data: newReceipt,
                    timestamp: Date.now()
                });
                localStorage.setItem('pendingUpdates', JSON.stringify(pendingUpdates));
                
                await showCustomDialog('Receipt saved locally. Will sync when connection is restored.', 'info');
            } else {
                // Try to sync with Firebase if online
                try {
                    if (currentUser) {
                        const userDoc = doc(window.firebaseDb, 'users', currentUser.uid);
                        await setDoc(userDoc, {
                            items: getItemsFromStorage(),
                            receipts: existingReceipts,
                            monthlyBudget: localStorage.getItem('monthlyBudget') || '0',
                            lastUpdated: Date.now()
                        }, { merge: true });
                    }
                } catch (syncError) {
                    console.error('Error syncing with server:', syncError);
                    await showCustomDialog('Receipt saved locally. Will retry sync later.', 'info');
                }
            }

            // Show the receipts list
            const receiptsList = document.getElementById('receipts-list');
            const showReceiptsBtn = document.getElementById('show-receipts-btn');
            
            if (receiptsList) {
                receiptsList.style.display = 'none';  // Hide the receipts list
                if (showReceiptsBtn) {
                    showReceiptsBtn.innerHTML = '<i class="fas fa-receipt"></i> View Receipts';  // Reset button text
                }
            }

            // Reset form fields
            document.getElementById('receipt-form').reset();
            
            // Clear file input (since .reset() doesn't always clear it in all browsers)
            const fileInput = document.getElementById('receipt-file');
            if (fileInput) {
                fileInput.value = '';
            }

            // Update UI
            displayReceipts();
            updateBudgetStats();

        } catch (error) {
            throw new Error(`Storage error: ${error.message}`);
        }

    } catch (error) {
        console.error('Error handling receipt upload:', error);
        let errorMessage = 'An error occurred while saving the receipt. ';
        if (error.message.includes('quota')) {
            errorMessage += 'Storage is full. Please delete some old receipts.';
        } else {
            errorMessage += error.message;
        }
        await showCustomDialog(errorMessage, 'alert');
    }
}

  // Add this helper function to read files
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Error reading file'));
        reader.readAsDataURL(file);
    });
  }

  // Update the showCustomDialog function to support different types
  function showCustomDialog(message, type = 'confirm') {
    return new Promise((resolve) => {
        const dialog = document.createElement('div');
        dialog.className = 'custom-dialog';
        
        const icon = type === 'info' ? 'fa-info-circle' : 
                    type === 'alert' ? 'fa-exclamation-triangle' : 
                    'fa-question-circle';
        
        const color = type === 'info' ? '#1976d2' : 
                     type === 'alert' ? '#d32f2f' : 
                     '#1a237e';
        
        dialog.innerHTML = `
            <div class="dialog-content">
                <i class="fas ${icon}" style="color: ${color}; font-size: 24px; margin-bottom: 15px;"></i>
                <h3>${message}</h3>
                <div class="dialog-buttons">
                    ${type === 'confirm' ? '<button class="btn-no">No</button>' : ''}
                    <button class="btn-yes">${type === 'confirm' ? 'Yes' : 'OK'}</button>
                </div>
            </div>
        `;
        
        // Add overlay
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';
        
        document.body.appendChild(overlay);
        document.body.appendChild(dialog);
        
        // Add event listeners
        if (type === 'confirm') {
            dialog.querySelector('.btn-no').addEventListener('click', () => {
                dialog.remove();
                overlay.remove();
                resolve(false);
            });
        }
        
        dialog.querySelector('.btn-yes').addEventListener('click', () => {
            dialog.remove();
            overlay.remove();
            resolve(true);
        });
    });
  }

  // Update the displayReceipts function
  function displayReceipts() {
    try {
        const receiptsList = document.getElementById('receipts-list');
        const showReceiptsBtn = document.getElementById('show-receipts-btn');
        
        if (!receiptsList) {
            console.error('Receipts list element not found');
            return;
        }
        
        // Get receipts and validate
        let storedReceipts;
        try {
            storedReceipts = getReceipts();
            if (!Array.isArray(storedReceipts)) {
                throw new Error('Invalid receipts data structure');
            }
        } catch (error) {
            console.error('Error loading receipts:', error);
            receiptsList.innerHTML = '<p style="text-align: center; color: #666;">Error loading receipts</p>';
            return;
        }
        
        // Sort receipts
        try {
            storedReceipts.sort((a, b) => {
                const dateA = new Date(a.date + 'T00:00:00Z');
                const dateB = new Date(b.date + 'T00:00:00Z');
                if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) {
                    throw new Error('Invalid date format');
                }
                return dateB - dateA;
            });
        } catch (error) {
            console.error('Error sorting receipts:', error);
            // Continue with unsorted receipts
        }
        
        // Clear existing receipts
        receiptsList.innerHTML = '';
        
        // Get currency symbol
        const currencySymbol = getCurrencySymbol(currencySelect?.value || 'USD');
        
        // Handle empty receipts
        if (storedReceipts.length === 0) {
            receiptsList.innerHTML = '<p style="text-align: center; color: #666;">No receipts found</p>';
            if (showReceiptsBtn) {
                showReceiptsBtn.innerHTML = '<i class="fas fa-receipt"></i> View Receipts';
            }
            return;
        }
        
        // Create and append receipt cards
        storedReceipts.forEach(receipt => {
            try {
                const div = document.createElement('div');
                div.className = 'receipt-card';
                
                // Validate receipt date
                const receiptDate = new Date(receipt.date + 'T00:00:00Z');
                if (isNaN(receiptDate.getTime())) {
                    throw new Error('Invalid receipt date');
                }
                
                const isImage = receipt.type?.startsWith('image/');
                const previewContent = isImage 
                    ? `<img src="${receipt.file}" alt="Receipt preview">` 
                    : '<i class="fas fa-file-pdf fa-3x"></i>';
                
                div.innerHTML = `
                    <div class="receipt-header">
                        <h3 class="receipt-title">${receipt.name || 'Unnamed Receipt'}</h3>
                        <span class="receipt-date">${receiptDate.toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            timeZone: 'UTC'
                        })}</span>
                    </div>
                    <div class="receipt-preview">
                        ${previewContent}
                    </div>
                    <div class="receipt-amount">
                        Total: ${currencySymbol}${parseFloat(receipt.amount || 0).toFixed(2)}
                    </div>
                    <div class="receipt-actions">
                        <button class="view-receipt">
                            <i class="fas fa-eye"></i> View
                        </button>
                        <button class="delete-receipt" data-id="${receipt.id}">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                    </div>
                `;
                
                // Add event listeners
                div.querySelector('.view-receipt').addEventListener('click', () => {
                    viewReceipt(receipt);
                });
                
                div.querySelector('.delete-receipt').addEventListener('click', async () => {
                    const confirmed = await showCustomDialog('Are you sure you want to delete this receipt?');
                    if (confirmed) {
                        deleteReceipt(receipt.id);
                    }
                });
                
                receiptsList.appendChild(div);
            } catch (cardError) {
                console.error('Error creating receipt card:', cardError);
                // Skip this receipt and continue with others
            }
        });
        
    } catch (error) {
        console.error('Error displaying receipts:', error);
        if (receiptsList) {
            receiptsList.innerHTML = '<p style="text-align: center; color: #666;">Error loading receipts</p>';
        }
    }
}

  function saveReceipt(receipt) {
    const receipts = getReceipts();
    receipts.push(receipt);
    localStorage.setItem('receipts', JSON.stringify(receipts));
  }

  function viewReceipt(receipt) {
    const newWindow = window.open('', '_blank');
    // Create date without timezone offset
    const receiptDate = new Date(receipt.date + 'T00:00:00Z');
    
    newWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${receipt.name} - Receipt View</title>
        <style>
          body {
            margin: 0;
            padding: 20px;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            min-height: 100vh;
            background: #f5f5f5;
            font-family: Arial, sans-serif;
          }
          .container {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            max-width: 100%;
            box-sizing: border-box;
          }
          .header {
            margin-bottom: 20px;
            text-align: center;
          }
          .header h1 {
            margin: 0;
            color: #1a237e;
            font-size: 24px;
          }
          .header p {
            margin: 5px 0;
            color: #666;
          }
          img {
            max-width: 100%;
            height: auto;
            display: block;
            margin: 0 auto;
          }
          object {
            width: 100%;
            height: 90vh;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${receipt.name}</h1>
            <p>Date: ${receiptDate.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              timeZone: 'UTC'
            })}</p>
            <p>Amount: ${getCurrencySymbol(currencySelect.value)}${parseFloat(receipt.amount).toFixed(2)}</p>
          </div>
          ${receipt.type.startsWith('image/') 
            ? `<img src="${receipt.file}" alt="Receipt">`
            : `<object data="${receipt.file}" type="application/pdf" width="100%" height="90vh">
                <p>Unable to display PDF. <a href="${receipt.file}" target="_blank">Download Instead</a></p>
               </object>`
          }
        </div>
      </body>
      </html>
    `);
    newWindow.document.close();
  }

  statusInput.addEventListener('change', function() {
    const currentStatus = this.value;
    if (currentStatus === 'current') {
      document.querySelector('.date-container').style.display = 'block';
      document.querySelector('.price-container').style.display = 'none';
      priceInput.value = '';
      unknownPriceCheckbox.checked = false;
    } else {
      document.querySelector('.date-container').style.display = 'none';
      document.querySelector('.price-container').style.display = 'flex';
      expiryInput.value = '';
      noExpiryCheckbox.checked = false;
    }
  });

  document.addEventListener('click', function(e) {
    // If we're not in edit mode, return early
    if (!isEditMode) return;

    // Check if click is outside the form and edited item
    const isClickInsideForm = itemForm.contains(e.target);
    const isClickInsideEditedItem = editItem && editItem.contains(e.target);
    const isClickOnEditButton = e.target.closest('.edit-item') || e.target.closest('.fa-pen');

    // If click is outside form and edited item, and not on an edit button, cancel edit mode
    if (!isClickInsideForm && !isClickInsideEditedItem && !isClickOnEditButton) {
      // Reset edit mode
      isEditMode = false;
      
      // Remove edit-mode-item class from any edited items
      document.querySelectorAll('.edit-mode-item').forEach(item => {
        item.classList.remove('edit-mode-item');
      });
      
      // Reset form
      itemForm.reset();
      
      // Reset submit button text
      const submitButton = itemForm.querySelector('button[type="submit"]');
      submitButton.innerHTML = '<i class="fa-solid fa-plus"></i> Add Item';
      
      // Reset checkboxes and inputs
      unknownPriceCheckbox.checked = false;
      noExpiryCheckbox.checked = false;
      priceInput.disabled = false;
      expiryInput.disabled = false;
      
      // Initialize form to show/hide appropriate fields
      initializeForm();
      
      editItem = null;
    }
  });

  // Add this function at the start of init()
  function showCustomDialog(message, type = 'confirm') {
    return new Promise((resolve) => {
      const dialog = document.createElement('div');
      dialog.className = 'move-item-dialog';
      
      // Add overlay
      const overlay = document.createElement('div');
      overlay.className = 'dialog-overlay';
      
      dialog.innerHTML = `
        <h3>${message}</h3>
        <div class="dialog-buttons">
          ${type === 'confirm' ? '<button class="btn-no">No</button>' : ''}
          <button class="btn-yes">${type === 'alert' ? 'OK' : 'Yes'}</button>
        </div>
      `;
      
      // Add styles
      dialog.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
        z-index: 1001;
        min-width: 300px;
        max-width: 90%;
      `;

      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 1000;
      `;
      
      document.body.appendChild(overlay);
      document.body.appendChild(dialog);
      
      // Add event listeners for buttons
      if (type === 'confirm') {
        const noButton = dialog.querySelector('.btn-no');
        noButton.addEventListener('click', () => {
          dialog.remove();
          overlay.remove();
          resolve(false);
        });
        // Style No button
        noButton.style.cssText = `
          padding: 8px 20px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          margin: 0 5px;
          color: white;
          background-color: #dc3545;
          transition: background-color 0.2s;
        `;
        noButton.onmouseover = () => noButton.style.backgroundColor = '#c82333';
        noButton.onmouseout = () => noButton.style.backgroundColor = '#dc3545';
      }
      
      const yesButton = dialog.querySelector('.btn-yes');
      yesButton.addEventListener('click', () => {
        dialog.remove();
        overlay.remove();
        resolve(true);
      });
      
      // Style Yes/OK button
      yesButton.style.cssText = `
        padding: 8px 20px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        margin: 0 5px;
        color: white;
        background-color: #28a745;
        transition: background-color 0.2s;
      `;
      yesButton.onmouseover = () => yesButton.style.backgroundColor = '#218838';
      yesButton.onmouseout = () => yesButton.style.backgroundColor = '#28a745';

      // Style the message
      dialog.querySelector('h3').style.cssText = `
        margin: 0 0 20px 0;
        color: #333;
        font-size: 16px;
        text-align: center;
      `;

      // Style the buttons container
      dialog.querySelector('.dialog-buttons').style.cssText = `
        display: flex;
        justify-content: center;
        gap: 10px;
        margin-top: 20px;
      `;
    });
  }

  // Update the removeItem function
  async function removeItem(item) {
    const confirmed = await showCustomDialog('Are you sure you want to remove this item?');
    if (confirmed) {
      const itemName = item.querySelector('.item-name').textContent;
      item.remove();
      removeItemFromStorage(itemName);
      checkUI();
      updateBudgetStats();
    }
  }

  // Update the clearSection function
  async function clearSection(listType) {
    // Remove the duplicate confirmation since it's already handled in the clear menu click event
    let items = getItemsFromStorage();
    
    switch(listType) {
      case 'all':
        localStorage.removeItem('items');
        localStorage.removeItem('receipts');
        document.querySelectorAll('.items').forEach(list => list.innerHTML = '');
        document.getElementById('receipts-list').innerHTML = '';
        break;
      case 'current':
        const filteredCurrent = items.filter(item => 
          item.status !== 'current' || isExpiringSoon(item.expiry));
        localStorage.setItem('items', JSON.stringify(filteredCurrent));
        document.getElementById('current-list-with-expiry').innerHTML = '';
        document.getElementById('current-list-no-expiry').innerHTML = '';
        break;
      case 'expiring':
        const filteredExpiring = items.filter(item => !isExpiringSoon(item.expiry));
        localStorage.setItem('items', JSON.stringify(filteredExpiring));
        document.getElementById('expiring-list').innerHTML = '';
        break;
      case 'need':
        const filteredNeed = items.filter(item => item.status !== 'need');
        localStorage.setItem('items', JSON.stringify(filteredNeed));
        document.getElementById('need-list').innerHTML = '';
        break;
      case 'receipts':
        localStorage.removeItem('receipts');
        document.getElementById('receipts-list').innerHTML = '';
        break;
    }
    
    // Sync with Firestore if user is logged in
    if (currentUser) {
        const userDoc = doc(db, 'users', currentUser.uid);
        setDoc(userDoc, {
            items: getItemsFromStorage(),
            receipts: getReceipts(),
            monthlyBudget: localStorage.getItem('monthlyBudget') || '0',
            lastUpdated: Date.now()
        }).catch(error => {
            console.error('Error syncing after clear:', error);
        });
    }
    
    updateTotalAmount();
    updateBudgetStats();
    checkUI();
  }

  // Update the deleteReceipt function
  async function deleteReceipt(id) {
    const confirmed = await showCustomDialog('Are you sure you want to delete this receipt?');
    if (confirmed) {
      // Get current receipts
      let receipts = getReceipts();
      // Filter out the deleted receipt
      receipts = receipts.filter(receipt => receipt.id !== id);
      // Update localStorage
      localStorage.setItem('receipts', JSON.stringify(receipts));

      // Sync with Firestore if user is logged in
      if (currentUser) {
        try {
          const userDoc = doc(db, 'users', currentUser.uid);
          await setDoc(userDoc, {
            items: getItemsFromStorage(),
            receipts: receipts,  // Update with new receipts array
            monthlyBudget: localStorage.getItem('monthlyBudget') || '0',
            lastUpdated: Date.now()
          });
        } catch (error) {
          console.error('Error syncing receipt deletion:', error);
          await showCustomDialog('Error syncing deletion. Please try again.', 'alert');
        }
      }

      // Update UI
      displayReceipts();
      updateBudgetStats();
    }
  }

  function updateBudgetDashboard() {
    const currentBudget = parseFloat(localStorage.getItem('monthlyBudget')) || 0;
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const today = new Date();
    const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const remainingDays = lastDayOfMonth - today.getDate();
    
    // Get receipts for current month
    const receipts = getReceipts();
    const monthlySpent = receipts.reduce((total, receipt) => {
      const receiptDate = new Date(receipt.date);
      if (receiptDate.getMonth() === currentMonth && 
          receiptDate.getFullYear() === currentYear) {
        return total + (parseFloat(receipt.amount) || 0);
      }
      return total;
    }, 0);

    const remaining = currentBudget - monthlySpent;
    const spentPercentage = currentBudget > 0 ? (monthlySpent / currentBudget) * 100 : 0;
    const currencySymbol = getCurrencySymbol(currencySelect.value);

    // Update main stats
    document.getElementById('current-budget').textContent = `${currencySymbol}${currentBudget.toFixed(2)}`;
    document.getElementById('spent-amount').textContent = `${currencySymbol}${monthlySpent.toFixed(2)}`;
    document.getElementById('remaining-budget').textContent = `${currencySymbol}${remaining.toFixed(2)}`;
    
    // Update status badges
    updateBudgetStatus(spentPercentage);
    document.getElementById('days-remaining').textContent = `${remainingDays} Days`;

    // Update progress bar and percentage
    const progressBar = document.getElementById('spending-progress');
    progressBar.style.width = `${Math.min(spentPercentage, 100)}%`;
    document.getElementById('spending-percentage').textContent = `${spentPercentage.toFixed(1)}% of budget used`;

    // Calculate and update daily stats
    const daysInMonth = lastDayOfMonth;
    const daysPassed = today.getDate();
    const dailyAverage = monthlySpent / daysPassed;
    const recommendedDaily = remaining / remainingDays;

    document.getElementById('daily-average').textContent = `${currencySymbol}${dailyAverage.toFixed(2)}`;
    document.getElementById('recommended-daily').textContent = `${currencySymbol}${recommendedDaily.toFixed(2)}`;

    // Calculate monthly comparison
    const lastMonthSpent = calculateLastMonthSpending(receipts);
    const monthlyComparison = lastMonthSpent > 0 
      ? ((monthlySpent - lastMonthSpent) / lastMonthSpent * 100)
      : 0;

    const comparisonElement = document.getElementById('month-comparison');
    comparisonElement.textContent = `${monthlyComparison > 0 ? '+' : ''}${monthlyComparison.toFixed(1)}%`;
    comparisonElement.className = `stat-value ${monthlyComparison > 0 ? 'trend-up' : 'trend-down'}`;

    // Calculate and update monthly average
    const monthlyAverage = calculateMonthlyAverage(receipts);
    document.getElementById('monthly-average').textContent = `${currencySymbol}${monthlyAverage.toFixed(2)}`;
  }

  function updateBudgetStatus(spentPercentage) {
    const budgetStatus = document.getElementById('budget-status');
    const spendingRate = document.getElementById('spending-rate');
    
    // Update budget status
    if (spentPercentage >= 100) {
      budgetStatus.textContent = 'Over Budget';
      budgetStatus.style.background = '#ffebee';
      budgetStatus.style.color = '#c62828';
    } else if (spentPercentage >= 90) {
      budgetStatus.textContent = 'Critical';
      budgetStatus.style.background = '#fff3e0';
      budgetStatus.style.color = '#e65100';
    } else if (spentPercentage >= 75) {
      budgetStatus.textContent = 'Warning';
      budgetStatus.style.background = '#fff8e1';
      budgetStatus.style.color = '#f57f17';
    } else {
      budgetStatus.textContent = 'On Track';
      budgetStatus.style.background = '#e8f5e9';
      budgetStatus.style.color = '#2e7d32';
    }

    // Update spending rate
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const daysPassed = new Date().getDate();
    const expectedPercentage = (daysPassed / daysInMonth) * 100;

    if (spentPercentage > expectedPercentage + 20) {
      spendingRate.textContent = 'High';
      spendingRate.style.background = '#ffebee';
      spendingRate.style.color = '#c62828';
    } else if (spentPercentage < expectedPercentage - 20) {
      spendingRate.textContent = 'Low';
      spendingRate.style.background = '#e8f5e9';
      spendingRate.style.color = '#2e7d32';
    } else {
      spendingRate.textContent = 'Normal';
      spendingRate.style.background = '#e3f2fd';
      spendingRate.style.color = '#1565c0';
    }
  }

  function calculateLastMonthSpending(receipts) {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    
    return receipts.reduce((total, receipt) => {
      const receiptDate = new Date(receipt.date);
      if (receiptDate.getMonth() === lastMonth.getMonth() && 
          receiptDate.getFullYear() === lastMonth.getFullYear()) {
        return total + (parseFloat(receipt.amount) || 0);
      }
      return total;
    }, 0);
  }

  function calculateMonthlyAverage(receipts) {
    if (receipts.length === 0) return 0;
    
    const months = new Set();
    let totalAmount = 0;
    
    receipts.forEach(receipt => {
      const date = new Date(receipt.date);
      months.add(`${date.getFullYear()}-${date.getMonth()}`);
      totalAmount += parseFloat(receipt.amount) || 0;
    });
    
    return totalAmount / Math.max(months.size, 1);
  }

  // Add filter functionality
  filterInput.addEventListener('input', filterItems);

  // Add this new function
  function filterItems(e) {
    const searchText = e.target.value.toLowerCase().trim();
    const items = document.querySelectorAll('.items li');

    if (!items.length) return; // Early return if no items

    items.forEach(item => {
        try {
            const itemName = item.querySelector('.item-name')?.textContent.toLowerCase() || '';
            const itemQuantity = item.querySelector('.item-quantity')?.textContent.toLowerCase() || '';
            const itemExpiry = item.querySelector('.item-expiry')?.textContent.toLowerCase() || '';
            const itemPrice = item.querySelector('.item-price')?.textContent.toLowerCase() || '';

            const shouldShow = 
                itemName.includes(searchText) || 
                itemQuantity.includes(searchText) || 
                itemExpiry.includes(searchText) || 
                itemPrice.includes(searchText);

            item.style.display = shouldShow ? 'flex' : 'none';
        } catch (error) {
            console.error('Error filtering item:', error);
            item.style.display = 'flex'; // Show item if error occurs
        }
    });
  }

  // Update the checkUI function to handle filter visibility
  function checkUI() {
    const items = document.querySelectorAll('.items li');
    const hasItems = items.length > 0;
    
    // Only show filter if there are items
    const filterInput = document.querySelector('#filter');
    if (filterInput) {
        filterInput.style.display = hasItems ? 'block' : 'none';
    }
  }

  sortSelect.addEventListener('change', function() {
    displayItems(this.value);
  });

  // Add this function to handle Google Sign In
  async function handleGoogleSignIn() {
    try {
      // Show loading screen
      document.getElementById('loading-screen').style.display = 'flex';
      document.getElementById('auth-container').style.display = 'none';
      
      console.log('Starting Google Sign In...');
      const result = await signInWithPopup(auth, provider);
      currentUser = result.user;
      
      // Store token
      const token = await result.user.getIdToken();
      localStorage.setItem('authToken', token);
      
    } catch (error) {
      console.error('Sign in error:', error);
      document.getElementById('loading-screen').style.display = 'none';
      document.getElementById('auth-container').style.display = 'flex';
      
      let errorMessage = 'Error signing in with Google. Please try again.';
      switch (error.code) {
        case 'auth/popup-blocked':
          errorMessage = 'Please allow popups for this website to sign in.';
          break;
        case 'auth/popup-closed-by-user':
          errorMessage = 'Sign-in was cancelled. Please try again.';
          break;
        case 'auth/unauthorized-domain':
          errorMessage = 'This domain is not authorized for sign-in.';
          break;
        case 'auth/network-request-failed':
          errorMessage = 'Network error. Please check your connection.';
          break;
        default:
          errorMessage = error.message;
      }
      
      await showCustomDialog(errorMessage, 'alert');
    }
  }

  // Add this function to handle Sign Out
  async function handleSignOut() {
    try {
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
      }
      
      // Clear all auth-related data
      localStorage.removeItem('authToken');
      sessionStorage.clear();
      
      // Sign out from Firebase
      await signOut(auth);
      currentUser = null;
      
      // Clear application data
      localStorage.clear();
      
      // Clear any cached credentials
      if (navigator.credentials && navigator.credentials.preventSilentAccess) {
        await navigator.credentials.preventSilentAccess();
      }
      
      // Reset UI
      displayItems();
      document.getElementById('auth-container').style.display = 'flex';
      document.getElementById('user-avatar').style.display = 'none';
      document.getElementById('user-name').textContent = '';
      document.getElementById('sign-out').style.display = 'none';
      
    } catch (error) {
      console.error('Error signing out:', error);
      await showCustomDialog('Error signing out. Please try again.', 'alert');
    }
  }

  // Add this function to initialize user data
  async function initializeUserData() {
    if (!currentUser) return;

    try {
      // Update UI
      const userAvatar = document.getElementById('user-avatar');
      const userName = document.getElementById('user-name');
      const signOutBtn = document.getElementById('sign-out');

      userAvatar.src = currentUser.photoURL;
      userAvatar.style.display = 'block';
      userName.textContent = currentUser.displayName;
      signOutBtn.style.display = 'block';

      // Get user's data from Firestore
      const userDoc = doc(db, 'users', currentUser.uid);
      const docSnap = await getDoc(userDoc);

      if (docSnap.exists()) {
        // If user data exists, use it
        const data = docSnap.data();
        localStorage.setItem('items', JSON.stringify(data.items || []));
        localStorage.setItem('receipts', JSON.stringify(data.receipts || []));
        localStorage.setItem('historyItems', JSON.stringify(data.historyItems || []));
        localStorage.setItem('monthlyBudget', data.monthlyBudget || '0');
      }

      // Set up real-time listener
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
      }

      unsubscribeSnapshot = onSnapshot(userDoc, (doc) => {
        if (doc.exists()) {
          const data = doc.data();
          localStorage.setItem('items', JSON.stringify(data.items || []));
          localStorage.setItem('receipts', JSON.stringify(data.receipts || []));
          localStorage.setItem('historyItems', JSON.stringify(data.historyItems || []));
          localStorage.setItem('monthlyBudget', data.monthlyBudget || '0');
          displayItems();
          displayReceipts();
          displayHistoryItems();
          updateBudgetStats();
        }
      });

      displayItems();
      displayReceipts();
      displayHistoryItems();
      updateBudgetStats();

    } catch (error) {
      console.error('Error initializing user data:', error);
      await showCustomDialog('Error loading your data. Please try again.', 'alert');
    }
  }

  // Add this function to enable offline support
  async function enableOfflineSupport() {
    try {
      await enableIndexedDbPersistence(db);
      console.log('Offline persistence enabled');
    } catch (error) {
      if (error.code === 'failed-precondition') {
        // Multiple tabs open, persistence can only be enabled in one tab at a time
        console.warn('Multiple tabs open, persistence disabled');
      } else if (error.code === 'unimplemented') {
        // The current browser doesn't support persistence
        console.warn('Browser doesn\'t support persistence');
      }
      // Continue without offline persistence
    }
  }

  // Update the mergeData function
  function mergeData(localData, serverData) {
    const merged = [...localData];
    const seen = new Set(merged.map(item => item.name));
    
    serverData.forEach(serverItem => {
      if (!seen.has(serverItem.name)) {
        merged.push(serverItem);
        seen.add(serverItem.name);
      } else {
        const localIndex = merged.findIndex(item => item.name === serverItem.name);
        const localItem = merged[localIndex];
        
        // Use the most recent version
        if (!localItem.timestamp || (serverItem.timestamp && serverItem.timestamp > localItem.timestamp)) {
          merged[localIndex] = serverItem;
        }
      }
    });
    
    return merged;
  }

  // Add auth state observer
  onAuthStateChanged(auth, async (user) => {
    try {
      const loadingScreen = document.getElementById('loading-screen');
      const authContainer = document.getElementById('auth-container');
      
      if (user) {
        // User is signed in
        currentUser = user;
        
        try {
          // Get new token and store it
          const token = await user.getIdToken(true);
          localStorage.setItem('authToken', token);
          
          await initializeUserData();
          authContainer.style.display = 'none';
          
          // Update UI for signed-in state
          const userAvatar = document.getElementById('user-avatar');
          const userName = document.getElementById('user-name');
          const signOutBtn = document.getElementById('sign-out');
          
          userAvatar.src = user.photoURL;
          userAvatar.style.display = 'block';
          userName.textContent = user.displayName;
          signOutBtn.style.display = 'block';
          
          // Clean up URL
          if (window.history && window.history.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        } catch (error) {
          console.error('Error initializing user data:', error);
          await showCustomDialog('Error loading your data. Please try again.', 'alert');
        }
      } else {
        // User is not signed in
        currentUser = null;
        localStorage.removeItem('authToken');
        authContainer.style.display = 'flex';
        
        // Reset UI
        document.getElementById('user-avatar').style.display = 'none';
        document.getElementById('user-name').textContent = '';
        document.getElementById('sign-out').style.display = 'none';
      }
    } catch (error) {
      console.error('Auth state change error:', error);
      document.getElementById('auth-container').style.display = 'flex';
    } finally {
      // Always hide loading screen after auth state is determined
      document.getElementById('loading-screen').style.display = 'none';
    }
  });

  // Add event listeners in init()
  document.getElementById('google-signin').addEventListener('click', async () => {
    if (checkFirebaseInitialization()) {
      await handleGoogleSignIn();
    }
  });
  document.getElementById('sign-out').addEventListener('click', handleSignOut);

  // Add this function to check if Firebase is properly initialized
  function checkFirebaseInitialization() {
    if (!auth || !provider || !db) {
      console.error('Firebase not properly initialized');
      showCustomDialog('Firebase initialization error. Please try again later.', 'alert');
      return false;
    }
    return true;
  }

  // Add timeout to prevent infinite loading
  function showLoadingWithTimeout() {
    const loadingScreen = document.getElementById('loading-screen');
    loadingScreen.style.display = 'flex';
    
    // Set a timeout to hide loading screen after 10 seconds
    setTimeout(() => {
      if (loadingScreen.style.display === 'flex') {
        loadingScreen.style.display = 'none';
        document.getElementById('auth-container').style.display = 'flex';
        showCustomDialog('Loading took too long. Please try again.', 'alert');
      }
    }, 10000); // 10 seconds timeout
  }

  // Add this function to your init() function
  function initializeClearButton() {
    const clearBtn = document.getElementById('clearBtn');
    const clearMenu = document.getElementById('clearMenu');
    let isMenuOpen = false;

    if (!clearBtn || !clearMenu) return;

    clearBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        isMenuOpen = !isMenuOpen;
        clearMenu.classList.toggle('active', isMenuOpen);
        clearBtn.style.transform = isMenuOpen ? 'rotate(135deg)' : 'rotate(0)';
    });

    document.querySelectorAll('.clear-menu-item').forEach(item => {
        item.addEventListener('click', async function(e) {
            e.stopPropagation();
            const clearType = this.dataset.clear;
            const confirmed = await showCustomDialog(
                `Are you sure you want to clear ${clearType === 'all' ? 'everything' : 'all ' + clearType + ' items'}?`
            );
            
            if (confirmed) {
                await clearSection(clearType);
                clearMenu.classList.remove('active');
                isMenuOpen = false;
                clearBtn.style.transform = 'rotate(0)';
            }
        });
    });

    // Close menu when clicking outside
    document.addEventListener('click', function(e) {
        if (!clearBtn.contains(e.target) && !clearMenu.contains(e.target) && isMenuOpen) {
            clearMenu.classList.remove('active');
            isMenuOpen = false;
            clearBtn.style.transform = 'rotate(0)';
        }
    });
  }

  // Add this line in your init() function after other initializations
  initializeClearButton();

  // Add this new function to handle all currency updates
  function updateAllCurrencyDisplays(currency) {
    try {
        if (!currency) {
            throw new Error('Invalid currency value');
        }
        
        const currencySymbol = getCurrencySymbol(currency);
        if (!currencySymbol) {
            throw new Error('Invalid currency symbol');
        }
        
        // Update shopping list items
        const items = document.querySelectorAll('.item-price');
        items.forEach(item => {
            try {
                const priceText = item.textContent;
                if (priceText.includes('Unknown')) return;
                
                const numbers = priceText.match(/[\d.]+/g);
                if (numbers && numbers.length >= 2) {
                    const price = parseFloat(numbers[0]);
                    const quantity = parseInt(numbers[1]);
                    if (!isNaN(price) && !isNaN(quantity)) {
                        item.textContent = `${currencySymbol}${price.toFixed(2)} × ${quantity} = ${currencySymbol}${(price * quantity).toFixed(2)}`;
                    }
                }
            } catch (itemError) {
                console.error('Error updating item price:', itemError);
            }
        });
        
        // Update other displays
        updateTotalAmount();
        displayReceipts();
        updateBudgetStats();
        
        // Update budget display
        const budget = parseFloat(localStorage.getItem('monthlyBudget')) || 0;
        if (currentBudgetDisplay) {
            currentBudgetDisplay.textContent = `${currencySymbol}${budget.toFixed(2)}`;
        }
        
    } catch (error) {
        console.error('Error updating currency displays:', error);
    }
  }

  // Add receipt form submit handler
  if (receiptForm) {
    receiptForm.addEventListener('submit', handleReceiptUpload);
  }

  // Add these utility functions for concurrency control
  function generateVersion() {
    return Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
  }

  async function resolveConflict(localData, serverData) {
    try {
        // Compare timestamps and versions
        if (!localData || !serverData) return serverData || localData;
        
        const localTimestamp = localData.lastUpdated || 0;
        const serverTimestamp = serverData.lastUpdated || 0;
        
        // If server data is newer, use it
        if (serverTimestamp > localTimestamp) {
            return serverData;
        }
        
        // If local data is newer, use it
        if (localTimestamp > serverTimestamp) {
            return localData;
        }
        
        // If timestamps are equal, merge the data
        if (localData.version !== serverData.version) {
            // Merge receipts from both sources, removing duplicates by ID
            const mergedReceipts = [...(serverData.receipts || [])];
            const localReceipts = localData.receipts || [];
            
            localReceipts.forEach(localReceipt => {
                if (!mergedReceipts.some(r => r.id === localReceipt.id)) {
                    mergedReceipts.push(localReceipt);
                }
            });
            
            return {
                ...serverData,
                receipts: mergedReceipts,
                version: generateVersion(),
                lastUpdated: Date.now()
            };
        }
        
        return localData;
    } catch (error) {
        console.error('Error resolving conflict:', error);
        // In case of error, return the most recent data
        return localTimestamp > serverTimestamp ? localData : serverData;
    }
  }

  // Add this function to handle real-time syncing
  async function setupRealtimeSync() {
    if (!currentUser || !window.firebaseDb) return;

    const userDoc = doc(window.firebaseDb, 'users', currentUser.uid);
    
    // Set up real-time listener
    return onSnapshot(userDoc, (doc) => {
        if (doc.exists()) {
            const serverData = doc.data();
            const localTimestamp = parseInt(localStorage.getItem('lastUpdated')) || 0;
            
            // Only update if server data is newer
            if (serverData.lastUpdated > localTimestamp) {
                // Update local storage
                localStorage.setItem('items', JSON.stringify(serverData.items || []));
                localStorage.setItem('receipts', JSON.stringify(serverData.receipts || []));
                localStorage.setItem('monthlyBudget', serverData.monthlyBudget || '0');
                localStorage.setItem('lastUpdated', serverData.lastUpdated.toString());

                // Update UI
                displayItems();
                displayReceipts();
                updateBudgetStats();
                console.log('Data synced from server:', new Date().toISOString());
            }
        }
    }, (error) => {
        console.error('Error in real-time sync:', error);
    });
  }

  // Update the syncPendingUpdates function
  async function syncPendingUpdates(retryCount = 3) {
    if (!navigator.onLine || !currentUser) return;
    
    try {
        const pendingUpdates = JSON.parse(localStorage.getItem('pendingUpdates') || '[]');
        if (pendingUpdates.length === 0) return;
        
        const userDoc = doc(window.firebaseDb, 'users', currentUser.uid);
        
        // Add retry logic with exponential backoff
        let attempt = 0;
        while (attempt < retryCount) {
            try {
                await runTransaction(window.firebaseDb, async (transaction) => {
                    const docSnap = await transaction.get(userDoc);
                    let serverData = docSnap.exists() ? docSnap.data() : {};
                    
                    // Merge server and local data
                    serverData.items = serverData.items || [];
                    serverData.receipts = serverData.receipts || [];
                    
                    // Apply pending updates
                    pendingUpdates.forEach(update => {
                        if (update.type === 'receipt') {
                            // Avoid duplicates
                            const index = serverData.receipts.findIndex(r => r.id === update.data.id);
                            if (index === -1) {
                                serverData.receipts.push(update.data);
                            }
                        }
                    });
                    
                    serverData.lastUpdated = Date.now();
                    
                    transaction.set(userDoc, serverData, { merge: true });
                });
                
                // Clear pending updates after successful sync
                localStorage.removeItem('pendingUpdates');
                console.log('Sync completed successfully:', new Date().toISOString());
                break;
                
            } catch (error) {
                attempt++;
                if (attempt === retryCount) throw error;
                // Exponential backoff
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            }
        }
    } catch (error) {
        console.error('Sync failed after retries:', error);
        throw error;
    }
  }

  // Update the init function
  function init() {
    if (!isFirebaseInitialized()) {
        console.error('Firebase not properly initialized');
        showCustomDialog('Application not properly initialized. Please refresh the page.', 'alert');
        return;
    }

    // Set up real-time sync
    let unsubscribeSync = null;
    
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            try {
                // Set up real-time sync
                unsubscribeSync = await setupRealtimeSync();
                
                // Initial sync
                await syncPendingUpdates();
            } catch (error) {
                console.error('Error setting up sync:', error);
            }
        } else if (unsubscribeSync) {
            unsubscribeSync();
            unsubscribeSync = null;
        }
    });

    // Improved online/offline handling
    window.addEventListener('online', async () => {
        console.log('Connection restored. Syncing data...');
        try {
            await syncPendingUpdates();
            await showCustomDialog('Connection restored. Data synced successfully.', 'info');
        } catch (error) {
            console.error('Error during sync:', error);
            await showCustomDialog('Error syncing data. Will retry automatically.', 'alert');
        }
    });

    window.addEventListener('offline', async () => {
        console.log('Device is offline. Changes will be saved locally.');
        await showCustomDialog('You are offline. Changes will be saved locally and synced when connection is restored.', 'info');
    });

    // More frequent sync checks for pending updates
    setInterval(async () => {
        if (navigator.onLine && currentUser) {
            try {
                await syncPendingUpdates();
            } catch (error) {
                console.error('Periodic sync failed:', error);
            }
        }
    }, 30 * 1000); // Check every 30 seconds

    // ... rest of your init code ...
  }

  // Add this helper function
  function isFirebaseInitialized() {
    return !!(window.firebaseDb && window.firebaseAuth && window.firebaseProvider);
  }

  // Replace any DOMSubtreeModified event listeners with MutationObserver
  function initializeDOMObserver() {
    const currentListWithExpiry = document.getElementById('current-list-with-expiry');
    const currentListNoExpiry = document.getElementById('current-list-no-expiry');
    const needList = document.getElementById('need-list');
    const expiringList = document.getElementById('expiring-list');
    const receiptsList = document.getElementById('receipts-list');

    const targetNodes = [
        currentListWithExpiry,
        currentListNoExpiry,
        needList,
        expiringList,
        receiptsList
    ].filter(node => node); // Filter out any null elements

    const config = {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true
    };

    const observer = new MutationObserver((mutationsList) => {
        // Debounce the updates to prevent too many rapid updates
        clearTimeout(window.updateTimeout);
        window.updateTimeout = setTimeout(() => {
            updateTotalAmount();
            updateBudgetStats();
            checkUI();
        }, 100);
    });

    targetNodes.forEach(node => {
        observer.observe(node, config);
    });

    return observer;
  }

  // Add this new function to handle moving items to completed/wasted
  async function moveItemToHistory(item, historyType) {
    const itemName = item.querySelector('.item-name').textContent;
    const itemQuantity = parseInt(item.querySelector('.item-quantity').textContent);
    
    // Get expiry text and clean it up properly
    let itemExpiry = item.querySelector('.item-expiry')?.textContent || '';
    if (itemExpiry) {
        // First, remove all variations of prefixes and clean up
        itemExpiry = itemExpiry
            .replace(/^(Expiry: |Expires: |Expired: |Expired on: )+/gi, '') // Remove all possible prefixes
            .replace(/Expires: /gi, '')  // Remove any remaining "Expires: "
            .replace(/\s+/g, ' ')        // Clean up extra spaces
            .trim();
    }
    
    // Create history item
    const historyItem = {
        id: Date.now().toString(),
        name: itemName,
        quantity: itemQuantity,
        expiry: itemExpiry || 'N/A',
        movedDate: new Date().toISOString(),
        type: historyType,
        timestamp: Date.now()
    };
    
    // Get existing history items
    let historyItems = getHistoryItems();
    historyItems.push(historyItem);
    localStorage.setItem('historyItems', JSON.stringify(historyItems));
    
    // Remove item from current list
    await removeItemFromStorage(itemName);
    item.remove();
    
    // Sync with Firebase if user is logged in
    if (currentUser) {
        try {
            const userDoc = doc(db, 'users', currentUser.uid);
            await setDoc(userDoc, {
                items: getItemsFromStorage(),
                receipts: getReceipts(),
                historyItems: historyItems,
                monthlyBudget: localStorage.getItem('monthlyBudget') || '0',
                lastUpdated: Date.now()
            });
        } catch (error) {
            console.error('Error syncing history:', error);
            await showCustomDialog('Error syncing history. Please try again.', 'alert');
        }
    }
    
    displayHistoryItems();
    checkUI();
    updateBudgetStats();
  }

  // Add function to remove history items
  async function removeHistoryItem(itemName, type) {
    const confirmed = await showCustomDialog('Are you sure you want to remove this item from history?');
    if (confirmed) {
      let historyItems = getHistoryItems();
      historyItems = historyItems.filter(item => !(item.name === itemName && item.type === type));
      localStorage.setItem('historyItems', JSON.stringify(historyItems));
      
      if (currentUser) {
        try {
          const userDoc = doc(db, 'users', currentUser.uid);
          await setDoc(userDoc, {
            items: getItemsFromStorage(),
            receipts: getReceipts(),
            historyItems: historyItems,
            monthlyBudget: localStorage.getItem('monthlyBudget') || '0',
            lastUpdated: Date.now()
          });
        } catch (error) {
          console.error('Error syncing history deletion:', error);
          await showCustomDialog('Error syncing history deletion. Please try again.', 'alert');
        }
      }
      
      displayHistoryItems();
      checkUI();
    }
  }

  // Add these functions to handle history items
  function getHistoryItems() {
    return localStorage.getItem('historyItems') ? JSON.parse(localStorage.getItem('historyItems')) : [];
  }

  function displayHistoryItems() {
    const historyItems = getHistoryItems();
    const completedList = document.getElementById('completed-list');
    const wastedList = document.getElementById('wasted-list');
    
    // Clear existing lists
    if (completedList) completedList.innerHTML = '';
    if (wastedList) wastedList.innerHTML = '';
    
    historyItems.forEach(item => {
        const li = document.createElement('li');
        li.className = 'history-item'; // Add class for specific styling
        
        li.innerHTML = `
            <div class="item-details">
                <div class="item-name">${item.name}</div>
                <span class="item-quantity">${item.quantity} units</span>
                <div class="move-date">Moved on: ${new Date(item.movedDate).toLocaleDateString()}</div>
            </div>
            <button class="remove-item btn-link text-red" onclick="removeHistoryItem('${item.name}', '${item.type}')">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;
        
        if (item.type === 'completed' && completedList) {
            completedList.appendChild(li);
        } else if (item.type === 'wasted' && wastedList) {
            wastedList.appendChild(li);
        }
    });
  }

  // Make removeHistoryItem globally accessible
  window.removeHistoryItem = async function(itemName, type) {
    const confirmed = await showCustomDialog('Are you sure you want to remove this item from history?');
    if (confirmed) {
      let historyItems = getHistoryItems();
      historyItems = historyItems.filter(item => !(item.name === itemName && item.type === type));
      localStorage.setItem('historyItems', JSON.stringify(historyItems));
      
      if (currentUser) {
        try {
          const userDoc = doc(db, 'users', currentUser.uid);
          await setDoc(userDoc, {
            items: getItemsFromStorage(),
            receipts: getReceipts(),
            historyItems: historyItems,
            monthlyBudget: localStorage.getItem('monthlyBudget') || '0',
            lastUpdated: Date.now()
          });
        } catch (error) {
          console.error('Error syncing history deletion:', error);
          await showCustomDialog('Error syncing history deletion. Please try again.', 'alert');
        }
      }
      
      displayHistoryItems();
      checkUI();
    }
  };

  // Add these event listeners outside of init()
  document.addEventListener('DOMContentLoaded', () => {
    displayHistoryItems();
    
    // Add click handlers for complete and waste buttons
    document.addEventListener('click', async (e) => {
      const target = e.target;
      
      // Handle complete button clicks
      if (target.closest('.complete-item')) {
        const listItem = target.closest('li');
        if (listItem) {
          await moveItemToHistory(listItem, 'completed');
        }
      }
      
      // Handle waste button clicks
      if (target.closest('.waste-item')) {
        const listItem = target.closest('li');
        if (listItem) {
          await moveItemToHistory(listItem, 'wasted');
        }
      }
    });
  });

  // Add these functions at the very top of your script.js file, outside of any other function
  function getCurrencySymbol(currency) {
    const symbols = {
      USD: '$',
      EUR: '€',
      GBP: '£',
      INR: '₹',
      JPY: '¥',
      AUD: 'A$',
      CAD: 'C$'
    };
    return symbols[currency] || currency;
  }
}