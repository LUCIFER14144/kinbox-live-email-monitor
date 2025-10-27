import React, { useState, useEffect } from 'react';
import {
  ChakraProvider,
  Box,
  VStack,
  HStack,
  Input,
  Button,
  Text,
  SimpleGrid,
  Card,
  CardBody,
  Badge,
  InputGroup,
  InputLeftElement,
  Spinner,
  useToast,
  Heading,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  Divider,
  Flex,
  Spacer,
  Icon
} from '@chakra-ui/react';
import { SearchIcon, EmailIcon, SettingsIcon } from '@chakra-ui/icons';

function App() {
  const [messages, setMessages] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [stats, setStats] = useState({ total: 0, inbox: 0, spam: 0, promotions: 0 });
  const [lastUpdate, setLastUpdate] = useState(null);
  const toast = useToast();

  // Auto-refresh every 5 seconds when configured
  useEffect(() => {
    if (!isConfigured) return;
    
    const interval = setInterval(() => {
      loadAllMessages(true); // Silent reload
    }, 5000);

    return () => clearInterval(interval);
  }, [isConfigured]);

  const loadAllMessages = async (silent = false) => {
    if (!email || !password) {
      toast({
        title: 'Configuration Required',
        description: 'Please enter your email and password first.',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    if (!silent) setLoading(true);

    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email,
          password: password,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const allMessages = data.messages || [];
      
      setMessages(allMessages);
      setLastUpdate(new Date());
      
      // Calculate stats
      const statsData = {
        total: allMessages.length,
        inbox: allMessages.filter(msg => msg.folder === 'INBOX').length,
        spam: allMessages.filter(msg => msg.folder === 'SPAM' || msg.folder === 'Junk').length,
        promotions: allMessages.filter(msg => msg.folder === 'PROMOTIONS' || msg.folder === 'Promotions').length
      };
      setStats(statsData);

      if (!silent) {
        toast({
          title: 'Emails Updated',
          description: `Loaded ${allMessages.length} emails successfully`,
          status: 'success',
          duration: 2000,
          isClosable: true,
        });
      }
    } catch (error) {
      console.error('Error loading messages:', error);
      if (!silent) {
        toast({
          title: 'Error',
          description: `Failed to load emails: ${error.message}`,
          status: 'error',
          duration: 5000,
          isClosable: true,
        });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleConfigure = () => {
    if (email && password) {
      setIsConfigured(true);
      loadAllMessages();
    } else {
      toast({
        title: 'Missing Information',
        description: 'Please enter both email and password.',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      });
    }
  };

  const searchMessages = async () => {
    if (!searchTerm.trim()) {
      toast({
        title: 'Search Required',
        description: 'Please enter a sender email to search.',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/search?sender=${encodeURIComponent(searchTerm)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email,
          password: password,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const searchResults = data.messages || [];
      
      setMessages(searchResults);
      toast({
        title: 'Search Complete',
        description: `Found ${searchResults.length} emails from "${searchTerm}"`,
        status: 'info',
        duration: 3000,
        isClosable: true,
      });
    } catch (error) {
      console.error('Error searching messages:', error);
      toast({
        title: 'Search Error',
        description: `Failed to search emails: ${error.message}`,
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  };

  const getFolderBadge = (folder) => {
    switch (folder?.toLowerCase()) {
      case 'inbox':
        return { emoji: '📥', color: 'blue', text: 'INBOX' };
      case 'spam':
      case 'junk':
        return { emoji: '🚫', color: 'red', text: 'SPAM' };
      case 'promotions':
        return { emoji: '🏷️', color: 'purple', text: 'PROMOTIONS' };
      default:
        return { emoji: '📁', color: 'gray', text: folder || 'UNKNOWN' };
    }
  };

  const EmailRow = ({ message, index }) => {
    const folderInfo = getFolderBadge(message.folder);
    
    return (
      <Card key={`${message.uid}-${index}`} mb={2} size="sm">
        <CardBody>
          <Flex align="center">
            <Box flex="1">
              <HStack spacing={3}>
                <Badge colorScheme={folderInfo.color} fontSize="xs">
                  {folderInfo.emoji} {folderInfo.text}
                </Badge>
                <Text fontWeight="bold" fontSize="sm">
                  {message.sender || 'Unknown Sender'}
                </Text>
                <Text fontSize="xs" color="gray.500">
                  {message.date || 'No Date'}
                </Text>
              </HStack>
              <Text mt={1} fontSize="sm" noOfLines={1}>
                {message.subject || 'No Subject'}
              </Text>
              {message.snippet && (
                <Text mt={1} fontSize="xs" color="gray.600" noOfLines={2}>
                  {message.snippet}
                </Text>
              )}
            </Box>
          </Flex>
        </CardBody>
      </Card>
    );
  };

  if (!isConfigured) {
    return (
      <ChakraProvider>
        <Box p={8} maxW="500px" mx="auto" mt="100px">
          <VStack spacing={6}>
            <Heading size="lg" textAlign="center">
              <Icon as={EmailIcon} mr={2} />
              Kinbox Live Email Monitor
            </Heading>
            <Text textAlign="center" color="gray.600">
              Enter your email credentials to start monitoring emails in real-time
            </Text>
            <VStack spacing={4} w="100%">
              <Input
                placeholder="Your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                size="lg"
              />
              <Input
                type="password"
                placeholder="Your email password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                size="lg"
              />
              <Button
                colorScheme="blue"
                size="lg"
                w="100%"
                onClick={handleConfigure}
                leftIcon={<SettingsIcon />}
              >
                Configure Email Monitor
              </Button>
            </VStack>
          </VStack>
        </Box>
      </ChakraProvider>
    );
  }

  return (
    <ChakraProvider>
      <Box p={4} minH="100vh" bg="gray.50">
        <VStack spacing={6} maxW="1200px" mx="auto">
          {/* Header */}
          <Box w="100%" bg="white" p={4} borderRadius="lg" shadow="sm">
            <Flex align="center">
              <Heading size="md">
                <Icon as={EmailIcon} mr={2} />
                Live Email Monitor
              </Heading>
              <Spacer />
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsConfigured(false)}
                leftIcon={<SettingsIcon />}
              >
                Reconfigure
              </Button>
            </Flex>
          </Box>

          {/* Stats Dashboard */}
          <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4} w="100%">
            <Stat bg="white" p={4} borderRadius="lg" shadow="sm">
              <StatLabel>Total Emails</StatLabel>
              <StatNumber>{stats.total}</StatNumber>
              <StatHelpText>All folders</StatHelpText>
            </Stat>
            <Stat bg="white" p={4} borderRadius="lg" shadow="sm">
              <StatLabel>📥 Inbox</StatLabel>
              <StatNumber color="blue.500">{stats.inbox}</StatNumber>
              <StatHelpText>Primary emails</StatHelpText>
            </Stat>
            <Stat bg="white" p={4} borderRadius="lg" shadow="sm">
              <StatLabel>🚫 Spam</StatLabel>
              <StatNumber color="red.500">{stats.spam}</StatNumber>
              <StatHelpText>Filtered out</StatHelpText>
            </Stat>
            <Stat bg="white" p={4} borderRadius="lg" shadow="sm">
              <StatLabel>🏷️ Promotions</StatLabel>
              <StatNumber color="purple.500">{stats.promotions}</StatNumber>
              <StatHelpText>Marketing emails</StatHelpText>
            </Stat>
          </SimpleGrid>

          {/* Search and Controls */}
          <Box w="100%" bg="white" p={4} borderRadius="lg" shadow="sm">
            <HStack spacing={4}>
              <InputGroup flex="1">
                <InputLeftElement pointerEvents="none">
                  <SearchIcon color="gray.300" />
                </InputLeftElement>
                <Input
                  placeholder="Search by sender email (e.g., newsletter@company.com)"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && searchMessages()}
                />
              </InputGroup>
              <Button colorScheme="blue" onClick={searchMessages} isLoading={loading}>
                Search
              </Button>
              <Button variant="outline" onClick={() => loadAllMessages()} isLoading={loading}>
                Refresh All
              </Button>
            </HStack>
            {lastUpdate && (
              <Text fontSize="xs" color="gray.500" mt={2}>
                Last updated: {lastUpdate.toLocaleTimeString()} • Auto-refresh every 5 seconds
              </Text>
            )}
          </Box>

          {/* Email List */}
          <Box w="100%" bg="white" borderRadius="lg" shadow="sm" maxH="600px" overflowY="auto">
            {loading && messages.length === 0 ? (
              <Box p={8} textAlign="center">
                <Spinner size="xl" mb={4} />
                <Text>Loading emails...</Text>
              </Box>
            ) : messages.length === 0 ? (
              <Box p={8} textAlign="center">
                <Text color="gray.500">
                  {searchTerm ? `No emails found from "${searchTerm}"` : 'No emails found. Click "Refresh All" to load emails.'}
                </Text>
              </Box>
            ) : (
              <Box p={4}>
                <Text fontSize="sm" color="gray.600" mb={4}>
                  Showing {messages.length} email{messages.length !== 1 ? 's' : ''} 
                  {searchTerm && ` from "${searchTerm}"`}
                </Text>
                <VStack spacing={2} align="stretch">
                  {messages.map((message, index) => (
                    <EmailRow key={`${message.uid}-${index}`} message={message} index={index} />
                  ))}
                </VStack>
              </Box>
            )}
          </Box>
        </VStack>
      </Box>
    </ChakraProvider>
  );
}

export default App;