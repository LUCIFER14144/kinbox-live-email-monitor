from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import imaplib
import email
from email.header import decode_header
import ssl
import json
import hashlib
import time
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
import re

app = FastAPI()

# Enable CORS for all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory cache as fallback
memory_cache = {}
CACHE_TTL = 600  # 10 minutes

class EmailCredentials(BaseModel):
    email: str
    password: str

class EmailMessage(BaseModel):
    uid: str
    sender: str
    subject: str
    date: str
    folder: str
    snippet: Optional[str] = None

def get_imap_server(email_address: str) -> str:
    """Get IMAP server based on email domain"""
    domain = email_address.split('@')[1].lower()
    
    if 'gmail' in domain:
        return 'imap.gmail.com'
    elif 'yahoo' in domain:
        return 'imap.mail.yahoo.com'
    elif 'outlook' in domain or 'hotmail' in domain or 'live' in domain:
        return 'outlook.office365.com'
    elif 'icloud' in domain:
        return 'imap.mail.me.com'
    else:
        # Try common patterns
        return f'imap.{domain}'

def decode_mime_words(s):
    """Decode MIME encoded words in email headers"""
    try:
        decoded_parts = decode_header(s)
        result = ""
        for part, encoding in decoded_parts:
            if isinstance(part, bytes):
                if encoding:
                    result += part.decode(encoding)
                else:
                    result += part.decode('utf-8', errors='ignore')
            else:
                result += part
        return result
    except:
        return str(s)

def extract_email_address(sender_field):
    """Extract email address from sender field"""
    try:
        if '<' in sender_field and '>' in sender_field:
            match = re.search(r'<([^>]+)>', sender_field)
            if match:
                return match.group(1).strip()
        return sender_field.strip()
    except:
        return sender_field

def get_cache_key(email: str, folder: str = "all") -> str:
    """Generate cache key for email data"""
    return hashlib.md5(f"{email}:{folder}".encode()).hexdigest()

def get_from_cache(key: str) -> Optional[Dict]:
    """Get data from cache"""
    try:
        # Check memory cache first
        if key in memory_cache:
            cached_data = memory_cache[key]
            if time.time() - cached_data['timestamp'] < CACHE_TTL:
                return cached_data['data']
            else:
                del memory_cache[key]
        return None
    except Exception as e:
        print(f"Cache read error: {e}")
        return None

def set_cache(key: str, data: Dict):
    """Set data in cache"""
    try:
        # Store in memory cache
        memory_cache[key] = {
            'data': data,
            'timestamp': time.time()
        }
    except Exception as e:
        print(f"Cache write error: {e}")

def connect_to_imap(email_address: str, password: str) -> imaplib.IMAP4_SSL:
    """Connect to IMAP server"""
    server = get_imap_server(email_address)
    
    try:
        # Create SSL context
        context = ssl.create_default_context()
        
        # Connect to server
        mail = imaplib.IMAP4_SSL(server, 993, ssl_context=context)
        mail.login(email_address, password)
        return mail
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Failed to connect to email server: {str(e)}")

def fetch_messages_from_folder(mail: imaplib.IMAP4_SSL, folder: str, limit: int = 50) -> List[Dict]:
    """Fetch messages from a specific folder"""
    messages = []
    
    try:
        # Select folder
        status, _ = mail.select(folder)
        if status != 'OK':
            return messages
        
        # Search for all messages
        status, message_ids = mail.search(None, 'ALL')
        if status != 'OK':
            return messages
        
        # Get message IDs
        ids = message_ids[0].split()
        
        # Get recent messages (limit to avoid timeout)
        recent_ids = ids[-limit:] if len(ids) > limit else ids
        
        for msg_id in reversed(recent_ids):  # Most recent first
            try:
                # Fetch message
                status, msg_data = mail.fetch(msg_id, '(RFC822)')
                if status != 'OK':
                    continue
                
                # Parse email
                raw_email = msg_data[0][1]
                email_message = email.message_from_bytes(raw_email)
                
                # Extract details
                sender = decode_mime_words(email_message.get('From', ''))
                subject = decode_mime_words(email_message.get('Subject', ''))
                date_str = email_message.get('Date', '')
                
                # Extract email snippet
                snippet = ""
                if email_message.is_multipart():
                    for part in email_message.walk():
                        if part.get_content_type() == "text/plain":
                            try:
                                payload = part.get_payload(decode=True)
                                if payload:
                                    snippet = payload.decode('utf-8', errors='ignore')[:200]
                                    break
                            except:
                                continue
                else:
                    try:
                        payload = email_message.get_payload(decode=True)
                        if payload:
                            snippet = payload.decode('utf-8', errors='ignore')[:200]
                    except:
                        pass
                
                # Clean up snippet
                snippet = ' '.join(snippet.split())[:200] if snippet else ""
                
                messages.append({
                    'uid': msg_id.decode(),
                    'sender': sender,
                    'subject': subject,
                    'date': date_str,
                    'folder': folder,
                    'snippet': snippet
                })
                
            except Exception as e:
                print(f"Error processing message {msg_id}: {e}")
                continue
        
    except Exception as e:
        print(f"Error fetching from folder {folder}: {e}")
    
    return messages

def fetch_messages_from_account(email_address: str, password: str) -> List[Dict]:
    """Fetch messages from all folders of an email account"""
    cache_key = get_cache_key(email_address)
    
    # Check cache first
    cached_data = get_from_cache(cache_key)
    if cached_data:
        return cached_data
    
    all_messages = []
    mail = None
    
    try:
        mail = connect_to_imap(email_address, password)
        
        # Common folder names to check
        folders_to_check = ['INBOX', 'SPAM', 'Junk', 'PROMOTIONS', 'Promotions', 'Sent', 'Drafts']
        
        # Get list of all folders
        try:
            status, folders = mail.list()
            if status == 'OK':
                available_folders = []
                for folder in folders:
                    folder_name = folder.decode().split(' "/" ')[-1].strip('"')
                    available_folders.append(folder_name)
                
                # Use available folders that match our common ones
                folders_to_check = [f for f in folders_to_check if f in available_folders]
                
                # If no common folders found, use first few available ones
                if not folders_to_check:
                    folders_to_check = available_folders[:5]
        except:
            # Fallback to common folder names
            folders_to_check = ['INBOX', 'SPAM', 'Junk']
        
        # Fetch messages from each folder
        for folder in folders_to_check:
            try:
                folder_messages = fetch_messages_from_folder(mail, folder, limit=30)
                all_messages.extend(folder_messages)
            except Exception as e:
                print(f"Error fetching from folder {folder}: {e}")
                continue
        
        # Sort by date (most recent first)
        all_messages.sort(key=lambda x: x.get('date', ''), reverse=True)
        
        # Cache the results
        set_cache(cache_key, all_messages)
        
        return all_messages
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching messages: {str(e)}")
    finally:
        if mail:
            try:
                mail.close()
                mail.logout()
            except:
                pass

@app.get("/")
async def root():
    return {"message": "Kinbox Live Email Monitor API", "status": "active"}

@app.post("/api/messages")
async def get_messages(credentials: EmailCredentials):
    """Get all messages from email account"""
    try:
        messages = fetch_messages_from_account(credentials.email, credentials.password)
        return {"messages": messages, "count": len(messages)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")

@app.post("/api/search")
async def search_messages(credentials: EmailCredentials, sender: str = None):
    """Search messages by sender"""
    try:
        if not sender:
            raise HTTPException(status_code=400, detail="Sender parameter is required")
        
        # Get all messages first
        all_messages = fetch_messages_from_account(credentials.email, credentials.password)
        
        # Filter by sender
        sender_lower = sender.lower()
        filtered_messages = []
        
        for message in all_messages:
            message_sender = message.get('sender', '').lower()
            sender_email = extract_email_address(message_sender).lower()
            
            if sender_lower in message_sender or sender_lower in sender_email:
                filtered_messages.append(message)
        
        return {"messages": filtered_messages, "count": len(filtered_messages), "search_term": sender}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search error: {str(e)}")

@app.get("/api/cron")
async def cron_refresh():
    """Endpoint for Vercel Cron to refresh cache"""
    try:
        # This would be called by Vercel Cron to keep cache fresh
        # For now, just return success
        return {"message": "Cron job executed", "timestamp": datetime.now(timezone.utc).isoformat()}
    except Exception as e:
        return {"error": str(e), "timestamp": datetime.now(timezone.utc).isoformat()}

# For debugging
@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "cache_size": len(memory_cache)
    }